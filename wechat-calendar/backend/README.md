# 后端部署说明

## 安装依赖
```bash
pip install -r requirements.txt
```

## 配置环境变量
```bash
export WX_APPID="wx61730f7510c54584"
#export WX_SECRET="你的小程序AppSecret"
#export SECRET_KEY="自定义JWT密钥（随机字符串）"
export ENV="dev"   # 开发模式：直接用code作为openid，无需真实微信环境
```

## 启动服务
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## API 文档
启动后访问: http://localhost:8000/docs

## 数据库
自动创建 calendar.db（SQLite），无需额外配置。
生产环境建议配置 DB_PATH 环境变量指定数据库路径。
