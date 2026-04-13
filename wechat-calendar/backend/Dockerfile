FROM python:3.7.11-slim
WORKDIR /app
COPY requirements.txt requirements.txt
RUN python -m pip install --upgrade pip
RUN pip3 install -r requirements.txt
COPY . .
EXPOSE 80
ENTRYPOINT ["sh", "-c" , "uvicorn main:app --host 0.0.0.0 --port 80"]