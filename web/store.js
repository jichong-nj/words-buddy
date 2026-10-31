import { defineStore } from 'pinia';
import { api } from './api';

export const useAuth = defineStore('auth', {
  state: () => ({
    user: null,
    needsSetup: false,
    loaded: false,
  }),
  getters: {
    isAdmin: (s) => !!s.user && s.user.role === 'admin',
  },
  actions: {
    async load() {
      try {
        const d = await api.get('/api/auth/status');
        this.needsSetup = !!d.needsSetup;
        this.user = d.user || null;
      } catch (e) {
        this.user = null;
      } finally {
        this.loaded = true;
      }
    },
    async login(payload) {
      const d = await api.post('/api/auth/login', payload);
      this.user = d.user || null;
      this.needsSetup = false;
      return this.user;
    },
    async setup(payload) {
      const d = await api.post('/api/auth/setup', payload);
      this.user = d.user || null;
      this.needsSetup = false;
      return this.user;
    },
    async logout() {
      try {
        await api.post('/api/auth/logout');
      } finally {
        this.user = null;
      }
    },
  },
});
