# ---- build the React app ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
# PocketBase URL is baked in at build time (CRA inlines REACT_APP_* vars).
ARG REACT_APP_POCKETBASE_URL
ENV REACT_APP_POCKETBASE_URL=$REACT_APP_POCKETBASE_URL
RUN yarn build

# ---- serve the static build with nginx ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
