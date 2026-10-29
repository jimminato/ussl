FROM node:20-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json server.js index.html style.css app.js manifest.webmanifest service-worker.js icon.svg ./
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node","server.js"]
