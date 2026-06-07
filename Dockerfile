# --- build stage: compile TypeScript -> dist/ ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime stage: lean image, prod deps only ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY certs ./certs

# PUW server ships an incomplete TLS chain — supply the missing Certum
# intermediate so Node can verify it (verification stays ON).
ENV NODE_EXTRA_CA_CERTS=/app/certs/certum-dv-tls-g2-r39.pem

CMD ["node", "dist/index.js"]
