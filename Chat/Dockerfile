FROM node:22
WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /ssl \
    && openssl req -x509 -newkey rsa:4096 \
       -keyout /ssl/key.pem \
       -out /ssl/cert.pem \
       -days 365 \
       -nodes \
       -subj "/C=DE/ST=Berlin/L=Berlin/O=MeineFirma/OU=IT/CN=localhost"

COPY . .
RUN npm install
EXPOSE 80 443 8080
CMD ["npm", "start"]