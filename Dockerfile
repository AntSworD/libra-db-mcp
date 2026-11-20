FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production WEB_BIND_ADDRESS=0.0.0.0 DB_CONFIG_DIR=/app/data
COPY package.json package-lock.json ./
RUN sed -i -E 's#https://packages\.aliyun\.com/[^/]+/npm/npm-registry/#https://registry.npmjs.org/#g' package-lock.json \
    && npm ci --omit=dev \
    && mkdir -p /app/data \
    && chown node:node /app/data
COPY src/ ./src/
USER node
EXPOSE 3000
CMD ["node", "src/web.js"]
