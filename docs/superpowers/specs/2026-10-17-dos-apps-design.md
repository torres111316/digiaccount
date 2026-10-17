# Dos apps y planes nuevos — diseño

Fecha: 17/10/2026 · Decidido con Luis en conversación.

## Por qué

En Venezuela el negocio lleva su **realidad** (recibos, cobros, inventario) y el contador
lleva lo **legal** (lo que se factura y se declara). Hoy no coinciden: el caso vivo es Luis
Pereira, que tiene su cuenta con sus recibos y, aparte, su empresa en la firma de Luis con
los libros que se declaran. Juntar las dos cosas en una sola base obligaría a que
coincidan a la fuerza. Se separan.

## Las dos apps

| App | Nombre | Módulos | Para quién |
|---|---|---|---|
| Negocio | **DigiAccount Gestión de Ventas e Inventario** | Ventas y CxC, Compras y CxP, Tesorería, Inventario | el negocio: su control interno |
| Contador | **DigiAccount Gestión Contable y Fiscal** | Contabilidad, Fiscal (libros, retenciones, declaraciones, Bóveda), Nómina | el contador: lo que se declara |

Comunes a las dos: Dashboard, Terceros, Usuarios, Mi Suscripción, Configuración, Planes.

**Reglas:**
- Las dos apps **no se conectan** entre sí (ni API ni copia automática). Lo fiscal el negocio
  se lo entrega al contador por aparte. Se conectarán cuando todo se facture.
- La app del contador sí se integra con fuentes **netamente fiscales**: imprentas digitales,
  proveedores de máquina fiscal (primer candidato: el de RADIAN), la futura app del SENIAT y
  el correo de Arelis. Cada integración es su propio proyecto; no entra aquí.
- **Una sola base de código.** Las dos apps son el mismo sistema; lo que cambia es qué módulos
  muestra y con qué nombre, según el plan. Lo personalizado (marca, nombres de cuentas,
  agentes) va por configuración, nunca por copias.

## Planes

| id (no cambia) | Nombre nuevo | App | Tope | Precio |
|---|---|---|---|---|
| contador_basico | Contador Básico | Contador | 3 | $49 / $490 |
| contador_pro | Contador PRO | Contador | 10, +5 por paquete, máx. 20 | $79 / $790 + $40 por paquete |
| firma_contable | **Firma a medida** | Contador (+ Negocio si lo pide) | según contrato | implementación + mantenimiento (no publicado) |
| pyme | Emprendimientos y PYME | Negocio | 1 | $29 / $290 |
| empresa_completa | Empresa Completa | Negocio + Contador | 1 | $99 / $990 |
| grupo_empresarial | **Grupo a medida** | Negocio + Contador | según contrato | implementación + mantenimiento (no publicado) |

Se conservan los `id` para no romper las cuentas existentes (la de Luis está en `firma_contable`).

- **Agentes IA:** solo en los planes a medida. Se encienden por cuenta con `cuentas.addon_agentes`
  (ya existe). Para el resto, el módulo **se oculta** (deja de mostrarse con candado).
- **Paquetes de PRO:** columna nueva `cuentas.empresas_extra` (0, 5 o 10), que solo cambia el
  fundador al cobrar el paquete. Tope = 10 + empresas_extra.
- **A medida:** el tope de empresas sale de `cuentas.max_empresas_contrato`, que pone el fundador.
- **Luis Pereira y Maria Gallardo** (pyme) ya ven solo los módulos del negocio: no requieren cambio.

## Cómo se verá

- El nombre de la app (en la barra lateral, debajo del logo, y en el título de la pestaña)
  sale del plan: Negocio → «Gestión de Ventas e Inventario»; Contador → «Gestión Contable y
  Fiscal»; Empresa Completa y a medida → las dos secciones en la barra, cada una con su
  nombre como encabezado.
- Los módulos de la **otra** app no aparecen (ni con candado). El candado queda solo para
  mejorar de plan dentro de la misma app.
- La pantalla de Planes dentro de la app muestra lo mismo que la web.

## Cambios

1. `assets/app.js` · `planGating`: `PLAN_MODULOS`, `LIMITE_EMPRESAS` y `PLAN_SLUG` con los
   nombres nuevos; ocultar en vez de bloquear lo que es de la otra app y los agentes sin add-on;
   tope de PRO con `empresas_extra`; nombre de la app según el plan.
2. `assets/app.js` · `planesModule`: tarjetas iguales a la web; quitar «Empresas ilimitadas».
3. `index.html`: encabezados de sección «Gestión de Ventas e Inventario» y «Gestión Contable y Fiscal».
4. SQL nuevo `sql/planes_dos_apps.sql`: renombrar los dos planes, columnas `empresas_extra` y
   `max_empresas_contrato`, y el trigger de tope de empresas con el cálculo nuevo.
5. Panel del fundador: poder poner `empresas_extra` y `max_empresas_contrato` a una cuenta.
6. `sw.js`: subir la versión de caché.

## Pruebas

- Bloque nuevo en `herramientas/pruebas/correr.js`: para cada plan, qué módulos quedan
  visibles, ocultos o con candado, y el tope de empresas (PRO con 0, 5 y 10 extra).
- Probar en el navegador con las cuentas reales: la de Luis (a medida), Roberth (PRO) y
  Luis Pereira (pyme).

## Pendiente de Luis

- El plan Contador Básico: la web promete «Nómina LOTTT», pero la app hoy no se la da
  (Básico = Contabilidad + Fiscal). Propuesta: dársela, para cumplir lo publicado.
- El precio de los agentes en los planes a medida (ver estimación de costos en la conversación).
