FROM node:alpine

WORKDIR /app

COPY package.json .
RUN npm install

COPY server.js .
COPY index.html ./index.html

EXPOSE 8080

CMD ["node", "server.js"]