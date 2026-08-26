FROM nginx:alpine
# Render Web Service con Docker — sirve estático sin build
COPY index.html juego.html docente.html styles.css /usr/share/nginx/html/
COPY js /usr/share/nginx/html/js
# SPA fallback: si la ruta no existe, servir index.html (para hash routing no es necesario, pero útil)
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  location / { try_files $uri $uri/ /index.html; }\n  # cache estático\n  location ~* \\.(css|js)$ { expires 1h; add_header Cache-Control "public"; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
