FROM node:22-alpine AS build
WORKDIR /app
COPY shared ./shared
COPY client/package*.json ./client/
RUN cd client && npm ci
COPY client ./client
RUN cd client && npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY shared ./shared
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
EXPOSE 4000
CMD ["node", "server/src/index.js"]
