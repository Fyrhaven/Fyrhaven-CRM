# The Fyrhaven record server, self-hosted (#68).
#
# There is no build step and no dependency to install: `node:http` and
# `node:sqlite` ship with the runtime, so the image is the runtime plus these
# four files. Pinned to a major so a rebuild cannot silently change the SQLite
# behaviour underneath a database that is already on a volume.
#
# The cloud service is **not** in this image or this repository: the shop, the
# customer accounts, the catalogue, billing and the operator panel live in
# Fyrhaven/Fyrhaven-CRM-Cloud and are never distributed.
FROM node:24-alpine

WORKDIR /app
COPY package.json server.js storage.js s3.js licence.js ./

# The database lives on a volume, never in an image layer.
ENV PORT=8080 \
    STORE_DB=/data/store.sqlite
VOLUME /data
EXPOSE 8080

# The `node` user ships with the image; the server never needs to be root.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

# Readiness is a real request, not just "the process is up".
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
