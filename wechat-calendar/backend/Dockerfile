FROM python:3.11-slim

WORKDIR /app

# Install CA certificates so httpx/openssl can verify HTTPS (e.g. api.weixin.qq.com)

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl openssl \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements.txt
RUN python -m pip install --upgrade pip
RUN pip3 install -r requirements.txt

COPY . .

EXPOSE 80
ENTRYPOINT ["sh", "-c" , "uvicorn main:app --host 0.0.0.0 --port 80"]
