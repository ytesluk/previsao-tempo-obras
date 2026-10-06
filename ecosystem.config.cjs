// PM2. Uso: pm2 start ecosystem.config.cjs && pm2 save
// (.cjs porque o projeto é ES module: o PM2 carrega este arquivo com require)
module.exports = {
  apps: [
    {
      name: 'previsao-tempo-obras',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1, // NUNCA mais de uma: duas conexões com a mesma sessão do WhatsApp se derrubam
      exec_mode: 'fork',
      autorestart: true,
      exp_backoff_restart_delay: 2000, // 2 s, 3 s, 4,5 s... até estabilizar
      max_restarts: 50,
      min_uptime: '30s',
      kill_timeout: 10000, // tempo para fechar a conexão do WhatsApp com calma
      watch: false,
      time: true, // prefixa as linhas do log do PM2 com data e hora
      merge_logs: true,
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      env: {
        NODE_ENV: 'production',
        TZ: 'America/Sao_Paulo',
      },
    },
  ],
};
