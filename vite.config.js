import { defineConfig } from 'vite'
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  root: 'src',
  base: "./",
  publicDir: '../public',
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11']
    })
  ],
  server: {
    open: true
  },
  build: {
    outDir: '../dist',
    // outDirがroot(src)の外にあるため、明示しないとViteが安全側に倒して
    // 古い成果物を残す。削除済みファイルがdist/へ残らないよう毎回空にする。
    emptyOutDir: true
  }
})