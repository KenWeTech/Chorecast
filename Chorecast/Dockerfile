FROM node:18-alpine AS base

WORKDIR /app

COPY package*.json ./

FROM base AS dependencies

RUN npm install --omit=dev

FROM base AS final

RUN mkdir -p data
RUN mkdir -p ssl

COPY --from=dependencies /app/node_modules ./node_modules

COPY . .

EXPOSE 3737
EXPOSE 3443

CMD [ "node", "server.js" ]
