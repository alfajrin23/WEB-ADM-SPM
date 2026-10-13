import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    define: {
      __SUPABASE_URL__: JSON.stringify(env.NEXT_PUBLIC_SUPABASE_URL || ''),
      __SUPABASE_ANON_KEY__: JSON.stringify(env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''),
    },
  };
});

