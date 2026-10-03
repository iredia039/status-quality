FROM node:22-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client ./
RUN npm run build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server ./
COPY --from=client /app/client/dist /app/client/dist
RUN mkdir -p uploads processed && chown -R node:node /app
USER node
ENV PORT=7860
EXPOSE 7860
CMD ["node", "index.js"]
