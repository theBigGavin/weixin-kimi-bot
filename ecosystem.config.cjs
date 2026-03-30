module.exports = {
  apps: [
    {
      name: "weixin-kimi-bot",
      script: "./dist/index.js",
      interpreter: "node",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",

      // ========================================
      // 默认环境 (production) - 生产环境
      // ========================================
      // 启动方式: pm2 start ecosystem.config.cjs
      // 或: pm2 start ecosystem.config.cjs --env production
      env: {
        NODE_ENV: "production",
        DEPLOY_ENV: "production",  // 部署环境: production 要求100%测试通过
      },

      // ========================================
      // Staging 环境 - 预发布/集成测试
      // ========================================
      // 启动方式: pm2 start ecosystem.config.cjs --env staging
      env_staging: {
        NODE_ENV: "production",
        DEPLOY_ENV: "staging",     // 部署环境: staging 允许跳过测试，但不允许失败
      },

      // ========================================
      // Development 环境 - 开发调试
      // ========================================
      // 启动方式: pm2 start ecosystem.config.cjs --env development
      env_development: {
        NODE_ENV: "development",
        DEPLOY_ENV: "development", // 部署环境: development 允许跳过和调试
      },

      // Log files
      log_file: "./logs/combined.log",
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // Restart policy
      min_uptime: "10s",
      max_restarts: 10,

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
