# start.ps1
$env:ENV = "dev"
$env:WX_APPID = "wx693bcdd462a748ea"

uvicorn main:app --host 0.0.0.0 --port 8080 --reload