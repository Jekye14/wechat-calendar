# 后端部署说明

## 安装依赖
```bash
pip install -r requirements.txt
```

## 配置环境变量
```bash
export WX_APPID="wx61730f7510c54584"
# export WX_SECRET="你的小程序AppSecret"
# export WX_TMPL_APPROVAL_RESULT="审核结果通知模板ID"
# export WX_TMPL_SCHEDULE_UPDATE="日程更新通知模板ID"
# export MYSQL_ADDRESS="127.0.0.1:3306"
# export MYSQL_USERNAME="root"
# export MYSQL_PASSWORD="你的数据库密码"
# export MYSQL_DATABASE="wechat_calendar"
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
启动时会自动在 MySQL 中创建所需表，包括 `wx_subscribe_prefs` 订阅偏好表。
