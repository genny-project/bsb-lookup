FROM node:7.3.0-onbuild
# replace this with your application's default port
EXPOSE 3333
HEALTHCHECK CMD curl --fail http://localhost:3333/health || exit 1
