# DigiAccount · frontend estático servido con Nginx (para EasyPanel)
FROM nginx:alpine

# Solo los archivos de la app (no .md ni sql/)
COPY index.html manifest.json sw.js /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets/

# Config de Nginx (caché y fallback a index.html)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
