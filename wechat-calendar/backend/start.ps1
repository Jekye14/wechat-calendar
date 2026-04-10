# start.ps1
$env:ENV = "dev"
$env:WX_APPID = "wx61730f7510c54584"

uvicorn main:app --host 0.0.0.0 --port 8080 --reload