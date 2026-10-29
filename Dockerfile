FROM node:20-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY package.json server.js index.html style.css app.js manifest.webmanifest service-worker.js icon.svg ./
RUN mkdir -p /data/uploads && chown -R node:node /app /data
USER node
EXPOSE 3000
CMD ["node","server.js"]
