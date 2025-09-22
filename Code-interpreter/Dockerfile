FROM node:22
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY . .
RUN npm install
EXPOSE 2463
CMD ["npm", "start"]
