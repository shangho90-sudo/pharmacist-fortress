FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY src/core ./src/core
COPY src/online/protocol.ts ./src/online/protocol.ts
ENV NODE_ENV=production
EXPOSE 3001
CMD ["npm", "run", "server"]
