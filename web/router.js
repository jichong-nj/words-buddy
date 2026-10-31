import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from './store';

const routes = [
  { path: '/', redirect: '/banks' },
  { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true } },
  { path: '/setup', component: () => import('./views/Setup.vue'), meta: { public: true } },
  { path: '/banks', component: () => import('./views/Banks.vue') },
  { path: '/banks/:id', component: () => import('./views/BankWords.vue') },
  { path: '/banks/:id/import', component: () => import('./views/Import.vue'), meta: { admin: true } },
  { path: '/batches', component: () => import('./views/Batches.vue'), meta: { admin: true } },
  { path: '/practice', component: () => import('./views/Practice.vue') },
  { path: '/practice/:id', redirect: '/practice' },
  { path: '/transform', component: () => import('./views/Transform.vue') },
  { path: '/transform/bank', component: () => import('./views/TransformBank.vue'), meta: { admin: true } },
  { path: '/reading', component: () => import('./views/Reading.vue') },
  { path: '/reading/bank', component: () => import('./views/ReadingBank.vue'), meta: { admin: true } },
  { path: '/mistakes', component: () => import('./views/Mistakes.vue') },
  { path: '/records', component: () => import('./views/Records.vue') },
  { path: '/records/:id', component: () => import('./views/RecordDetail.vue') },
  { path: '/stats', component: () => import('./views/Stats.vue') },
  { path: '/users', component: () => import('./views/Users.vue'), meta: { admin: true } },
  { path: '/:pathMatch(.*)*', redirect: '/banks' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuth();
  if (!auth.loaded) await auth.load();

  // 还没有任何账号 → 先去初始化
  if (auth.needsSetup && to.path !== '/setup') return '/setup';

  if (to.meta.public) {
    // 已登录不必再进登录/初始化页
    if (auth.user && (to.path === '/login' || to.path === '/setup')) return '/banks';
    return true;
  }

  if (!auth.user) return '/login';
  // 学生不能进管理页
  if (to.meta.admin && !auth.isAdmin) return '/banks';
  return true;
});

export default router;
