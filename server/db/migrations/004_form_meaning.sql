-- 变形填空：每道题补充「句子中文意思」与「原型词中文意思」，作答后展示
ALTER TABLE transform_item ADD COLUMN sentence_cn TEXT;
ALTER TABLE transform_item ADD COLUMN word_cn TEXT;

-- 练习/记录快照，保证题库改动或删除后历史记录仍能看到当时的意思
ALTER TABLE practice_item ADD COLUMN sentence_cn_snapshot TEXT;
ALTER TABLE practice_item ADD COLUMN word_cn_snapshot TEXT;
