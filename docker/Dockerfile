FROM node:24-bookworm-slim
WORKDIR /source
COPY package.json package-lock.json ./
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci --ignore-scripts
COPY . .
CMD ["npm", "run", "check"]
