# Carlos G

**Senior Technical Lead · Arquitecto de Software**
Bogotá, Colombia · Remoto

<sub>Español · <a href="README_EN.md">English</a></sub>

---

Diseño y llevo a producción sistemas distribuidos sobre Azure, con automatización
basada en IA. Vengo además de la UX y la informática educativa, así que no separo
"que funcione" de "que alguien pueda usarlo": lo mismo escribo el Bicep del
ambiente que el research con usuarios que decide qué se construye.

**Abierto a** posiciones de Arquitectura de Software, AI/GenAI Engineering y Cloud.
[LinkedIn](https://www.linkedin.com/in/userpersona/) &nbsp;·&nbsp; [fgoguerra@gmail.com](mailto:fgoguerra@gmail.com)

---

### 01 · Trabajo seleccionado

| Proyecto | Qué resuelve | Stack |
| :-- | :-- | :-- |
| **[n8n-nodes-icd11](https://github.com/Owito/n8n-nodes-icd11)** <br><sub>[npm](https://www.npmjs.com/package/n8n-nodes-icd11)</sub> | Nodo comunitario que expone la API ICD-11 de la OMS dentro de n8n. Publicado con *trusted publishing* vía OIDC: cero tokens de larga vida en el pipeline. | TypeScript · n8n SDK · OIDC |
| **[Rehabilitación Continua CO](https://github.com/Owito/rehabilitacion-continua-co)** <br><sub>[en vivo](https://owito.github.io/rehabilitacion-continua-co/)</sub> | Directorio de educación continua en rehabilitación. Tres proveedores de LLM fallaron la extracción, así que el mecanismo real es curaduría verificada sobre sitemaps. | Astro · TypeScript · CI/CD |
| **[Margoth](https://github.com/Owito/margoth)** | Aplicación de escritorio para rehabilitación cognitiva y del lenguaje. 100% offline por diseño: el dato clínico nunca sale del equipo. | Python · PyQt6 · Privacy by Design |
| **[PoliMarket](https://github.com/Owito/polimarket-arquitectura)** <br><sub>[en vivo](https://owito.github.io/polimarket-arquitectura/)</sub> | Arquitectura de componentes distribuidos con separación estricta de capas: API REST en Go sin frameworks y cliente CLI en Rust. | Go · Rust · Render |
| **[NERV UI](https://github.com/Owito/nerv-ui)** <br><sub>[demo](https://owito.github.io/nerv-ui/)</sub> | Sistema de diseño CSS open source, distribuido por CDN bajo licencia MIT. | CSS · Design System · jsDelivr |
| **[Telecom Lab](https://github.com/Owito/telecom-lab)** <br><sub>[en vivo](https://owito.github.io/telecom-lab/)</sub> | Herramientas web y autocalificador de subnetting/VLSM, sobre un motor de cálculo con pruebas. | Astro · TypeScript · Vitest |

---

### 02 · Cómo trabajo

- **Infraestructura como código, o no cuenta.** Bicep con `what-if` previo, Container
  Apps, secretos por Key Vault con Managed Identity. Ningún secreto vive en el repo.
- **12-Factor como criterio de salida.** En el último backend que lideré, el servicio
  pasó de cumplir 2 de los 12 factores a 9 antes de que lo diera por desplegable.
- **La seguridad va antes del pentest, no después.** En la última plataforma cerré
  37 de 41 hallazgos (90%) y los validé en producción, no en un documento.
- **Pruebas donde cambian decisiones.** Pirámide real por niveles, no cobertura de vanidad.
- **Privacy by Design.** Cuando el dato es sensible, el procesamiento es local: Margoth
  y mi app de notas corren modelos de IA 100% offline.

---

### 03 · Actividad

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/stats-es-dark.svg">
  <img alt="Contribuciones, pull requests integrados y repositorios" src="assets/stats-es-light.svg" width="100%">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/langs-es-dark.svg">
  <img alt="Distribución del código por lenguaje" src="assets/langs-es-light.svg" width="100%">
</picture>

<sub>Estas tarjetas se generan desde la API de GitHub y se versionan en este repositorio
(<a href="scripts/generate-stats.mjs"><code>scripts/generate-stats.mjs</code></a>), así que no dependen
de ningún servicio externo que pueda caerse. Sin rachas: la mayor parte de mi trabajo ocurre
en repositorios privados de cliente y en ciclos por entrega, no en commits diarios.</sub>

---

### 04 · Stack

**Arquitectura y backend**
TypeScript · Kotlin · Python · Go · Rust · Java · PHP
DDD · Arquitectura hexagonal · Microservicios · API REST · 12-Factor

**Cloud, DevOps e IaC**
Azure (Container Apps, PostgreSQL, Key Vault, App Gateway) · Docker · Kubernetes
Bicep · Terraform · Azure DevOps · GitHub Actions · Linux

**IA y automatización**
n8n · RAG con pgvector · Sistemas multi-agente · APIs de Claude y Gemini

**Frontend y UX**
Astro · React · Jetpack Compose · JavaScript · CSS · Figma
Heurísticas de Nielsen · Neurodiversity Design System · Accesibilidad

---

### 05 · Trayectoria

**Senior Technical Lead · Arquitecto de Software** · *actual*
Arquitectura de plataformas GenIA sobre Azure, migración de PostgreSQL a infraestructura
gestionada, hardening y automatización con IA. Del diseño de la infraestructura al pipeline.

**Diseñador instruccional senior y plataformas educativas** · *2020 a 2024*
Producto educativo y metodologías ágiles en EFAE, Área Andina y FUNDEINCO.

**UX Developer · Orange Mia!** · *2023*
Desarrollo web e investigación centrada en el usuario.

---

### 06 · Formación

- **Máster en Arquitectura de Software** · Politécnico Grancolombiano · *en curso*
- **Ingeniería de Software** · Politécnico Grancolombiano
- **Magíster en Informática Educativa** · Universidad de La Sabana
- **Fonoaudiólogo** · Universidad de Pamplona

---

<sub>¿Un rol, un proyecto o una segunda opinión sobre una arquitectura?
Escríbeme a <a href="mailto:fgoguerra@gmail.com">fgoguerra@gmail.com</a> o por
<a href="https://www.linkedin.com/in/userpersona/">LinkedIn</a>.</sub>
