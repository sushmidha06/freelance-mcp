FROM node:20-alpine

WORKDIR /app

# Copy server package and install production deps only
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# Copy server source
COPY server/ .

EXPOSE 3001

CMD ["node", "index.js"]
