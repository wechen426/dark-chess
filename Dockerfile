FROM node:20-alpine
WORKDIR /app
COPY index.html mahjong.html package.json ./
COPY client ./client
COPY shared ./shared
COPY server ./server
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server/server.js"]
