#!/usr/bin/env python3
"""
听写音频批量生成：MOSS-TTS-Nano（本地 ONNX / CPU，无需联网、无需密钥）
→ ffmpeg 后处理（单声道 + 高通 + 清辅音提升 + 响度归一 -16 LUFS + AAC）
→ 写入内容寻址缓存 data/audio/dictation/

⚠️ 缓存键算法必须与 server/services/tts.js 的 dictRefPathFor() 完全一致：
     sha256(f"{provider}|{voice}|{speed}|{fmt}|{归一化句子}")[:32] + "." + fmt
   归一化 = 折叠所有空白为单个空格并去首尾空白。

用法：
  # 单进程
  python3 scripts/gen-dictation-audio-moss.py --voice adam
  # 4 进程并行（分片互不重叠）
  for k in 0 1 2 3; do python3 scripts/gen-dictation-audio-moss.py --shard $k/4 & done; wait
  # 只看还缺多少
  python3 scripts/gen-dictation-audio-moss.py --check
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICE_PRESETS = {
    'ava': 'Ava', 'bella': 'Bella', 'adam': 'Adam', 'nathan': 'Nathan',
    'trump': 'Trump', 'junhao': 'Junhao', 'zhiming': 'Zhiming', 'weiguo': 'Weiguo',
    'xiaoyu': 'Xiaoyu', 'yuewen': 'Yuewen', 'lingyu': 'Lingyu',
}
# 单声道 + 去低频隆隆 + 3~5kHz 清辅音提升 + 两遍 loudnorm 线性响度归一
PRE_FILTER = 'pan=mono|c0=0.5*c0+0.5*c1,highpass=f=80,equalizer=f=4000:t=q:w=1.6:g=2.5,aresample=44100'


def norm(s: str) -> str:
    return re.sub(r'\s+', ' ', str(s or '')).strip()


def measure_loudness(src: str, target_i: float, tp: float, lra: int) -> dict | None:
    """两遍 loudnorm 的第一遍：测出实测响度，供第二遍做线性归一（短音频比单遍准得多）。"""
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', src,
                        '-af', f'loudnorm=I={target_i}:TP={tp}:LRA={lra}:print_format=json',
                        '-f', 'null', '-'], capture_output=True, text=True)
    txt = r.stderr or ''
    start = txt.rfind('{')
    end = txt.rfind('}')
    if start < 0 or end <= start:
        return None
    try:
        j = json.loads(txt[start:end + 1])
    except json.JSONDecodeError:
        return None
    if 'input_i' not in j:
        return None
    return {k: j[k] for k in ('input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset')}


def transcode(src: str, dst: str, bitrate: str, target_i: float, tp: float, lra: int,
              makeup: float = 3.0, ceiling: float = 0.70) -> None:
    """两遍 loudnorm 线性归一 + 固定补偿增益 + 真峰值限制（level=disabled 才不会被 alimiter 自动增益抵消）。"""
    m = measure_loudness(src, target_i, tp, lra)
    if m:
        ln = (f'loudnorm=I={target_i}:TP={tp}:LRA={lra}'
              f":measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
              f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    else:                                    # 解析失败退回单遍动态归一
        ln = f'loudnorm=I={target_i}:TP={tp}:LRA={lra}'
    tail = f'volume={makeup}dB,alimiter=limit={ceiling}:level=disabled' if makeup or ceiling else None
    af = f'{PRE_FILTER},{ln}' + (f',{tail}' if tail else '')
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', src,
                    '-af', af, '-c:a', 'aac', '-b:a', bitrate,
                    '-movflags', '+faststart', dst], check=True, capture_output=True)


def cache_key(text: str, provider: str, voice: str, speed: str, fmt: str) -> str:
    raw = f'{provider}|{voice}|{speed}|{fmt}|{text}'
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]


def opt(name: str, default):
    argv = sys.argv
    i = argv.find(f'--{name}')
    if i > -1 and i + 1 < len(argv) and not argv[i + 1].startswith('--'):
        return argv[i + 1]
    return default


def parse_args():
    p = argparse.ArgumentParser(description='MOSS-TTS-Nano 批量生成听写音频')
    p.add_argument('--db', default=str(ROOT / 'data' / 'words.db'))
    p.add_argument('--out-dir', default=str(ROOT / 'data' / 'audio' / 'dictation'))
    p.add_argument('--provider', default='moss')
    p.add_argument('--voice', default='adam', help='内置音色：adam / ava / bella / nathan')
    p.add_argument('--speed', default='1.0')
    p.add_argument('--fmt', default='m4a')
    p.add_argument('--bitrate', default='64k')
    p.add_argument('--target-i', type=float, default=-16.0,
                   help='loudnorm 线性目标响度 LUFS（默认 -16）')
    p.add_argument('--tp', type=float, default=-1.5, help='真峰值上限 dBTP')
    p.add_argument('--lra', type=int, default=11, help='响度范围 LRA')
    p.add_argument('--makeup', type=float, default=3.0,
                   help='归一后再加的电平 dB（默认 +3，成品约 -15.7 LUFS，比现状 espeak 响约 4.3dB）')
    p.add_argument('--ceiling', type=float, default=0.70,
                   help='限幅器线性上限（0.70 ≈ -3.1dB，留出有损编码过冲余量）')
    p.add_argument('--shard', default='0/1', help='分片 k/n，多进程并行用')
    p.add_argument('--limit', type=int, default=0)
    p.add_argument('--threads', type=int, default=6, help='每个进程的 ONNX CPU 线程数')
    p.add_argument('--seed', type=int, default=42)
    p.add_argument('--moss-home', default=os.environ.get('MOSS_TTS_HOME', str(Path.home() / 'Projects' / 'MOSS-TTS-Nano')))
    p.add_argument('--model-dir', default=None, help='默认 <moss-home>/models/MOSS-TTS-Nano-100M-ONNX')
    p.add_argument('--temp-dir', default=None, help='默认 <out-dir>/.tmp')
    p.add_argument('--fail-log', default=None, help='默认 <out-dir>/gen-failures.jsonl')
    p.add_argument('--overwrite', action='store_true', help='已存在也重新生成')
    p.add_argument('--check', action='store_true', help='只统计缺失数量，不生成')
    return p.parse_args()


def main() -> int:
    a = parse_args()
    preset = VOICE_PRESETS.get(a.voice.lower(), a.voice)
    out_dir = Path(a.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    temp_dir = Path(a.temp_dir or (out_dir / '.tmp'))
    temp_dir.mkdir(parents=True, exist_ok=True)
    fail_log = Path(a.fail_log or (out_dir / 'gen-failures.jsonl'))

    shard_idx, shard_n = (int(x) for x in a.shard.split('/'))
    if not 0 <= shard_idx < shard_n:
        print(f'--shard 需要 k/n 且 0<=k<n，收到 {a.shard}', file=sys.stderr)
        return 2

    con = sqlite3.connect(f'file:{a.db}?mode=ro', uri=True)
    rows = [(r[0], norm(r[1])) for r in con.execute('SELECT id, sentence_en FROM dictation_item ORDER BY id')]
    con.close()
    rows = [r for r in rows if r[1]]
    if shard_n > 1:
        rows = [r for i, r in enumerate(rows) if i % shard_n == shard_idx]
    if a.limit:
        rows = rows[:a.limit]

    def target(text: str) -> Path:
        return out_dir / f'{cache_key(text, a.provider, a.voice, a.speed, a.fmt)}.{a.fmt}'

    missing = [r for r in rows if a.overwrite or not (target(r[1]).exists() and target(r[1]).stat().st_size > 1024)]
    print(f'[{a.shard}] 本片 {len(rows)} 句，已缓存 {len(rows) - len(missing)}，待生成 {len(missing)}，'
          f'音色 {preset}，输出 {out_dir}', flush=True)
    if a.check:
        return 0
    if not missing:
        return 0

    moss_home = Path(a.moss_home)
    if not moss_home.exists():
        print(f'找不到 MOSS-TTS-Nano：{moss_home}（用 --moss-home 或环境变量 MOSS_TTS_HOME 指定）', file=sys.stderr)
        return 2
    sys.path.insert(0, str(moss_home))
    try:
        from onnx_tts_runtime import OnnxTtsRuntime      # noqa: E402
    except Exception as exc:                            # noqa: BLE001
        print(f'导入 OnnxTtsRuntime 失败：{exc}\n请先激活装了 torch/onnxruntime 的环境再运行', file=sys.stderr)
        return 2
    model_dir = a.model_dir or str(moss_home / 'models' / 'MOSS-TTS-Nano-100M-ONNX')
    if not Path(model_dir).exists():
        print(f'找不到 ONNX 模型目录：{model_dir}', file=sys.stderr)
        return 2

    t_load = time.time()
    rt = OnnxTtsRuntime(model_dir=model_dir, thread_count=a.threads, execution_provider='cpu')
    print(f'模型加载 {time.time() - t_load:.1f}s（{a.threads} 线程）', flush=True)

    made = failed = 0
    bytes_out = 0
    t0 = time.time()
    with fail_log.open('a', encoding='utf-8') as flog:
        for n, (item_id, text) in enumerate(missing, 1):
            wav = temp_dir / f'w{os.getpid()}.wav'
            m4a = temp_dir / f'a{os.getpid()}.{a.fmt}'
            dst = target(text)
            try:
                rt.synthesize(text=text, voice=preset, output_audio_path=str(wav),
                              streaming=False, enable_wetext=False, seed=a.seed)
                transcode(str(wav), str(m4a), a.bitrate, a.target_i, a.tp, a.lra, a.makeup, a.ceiling)
                if m4a.stat().st_size <= 512:
                    raise RuntimeError('output_too_small')
                os.replace(m4a, dst)                    # 原子落盘
                bytes_out += dst.stat().st_size
                made += 1
            except Exception as exc:                    # noqa: BLE001
                failed += 1
                flog.write(json.dumps({'id': item_id, 'sentence': text, 'error': str(exc)[:300]},
                                      ensure_ascii=False) + '\n')
                flog.flush()
            finally:
                for p in (wav, m4a):
                    if p.exists():
                        try:
                            p.unlink()
                        except OSError:
                            pass
            if n % 25 == 0 or n == len(missing):
                el = time.time() - t0
                rate = n / el if el else 0
                eta = (len(missing) - n) / rate if rate else 0
                print(f'[{a.shard}] {n}/{len(missing)}  {rate:.2f} 句/秒  '
                      f'剩余 {eta / 60:.1f} 分钟  {bytes_out / 1048576:.0f}MB  失败 {failed}', flush=True)

    print(f'[{a.shard}] 完成：新增 {made}，失败 {failed}，'
          f'{bytes_out / 1048576:.0f}MB，用时 {(time.time() - t0) / 60:.1f} 分钟', flush=True)
    if failed:
        print(f'[{a.shard}] 失败清单：{fail_log}', flush=True)
    shutil.rmtree(temp_dir, ignore_errors=True) if not any(temp_dir.iterdir()) else None
    return 0 if not failed else 1


if __name__ == '__main__':
    sys.exit(main())
