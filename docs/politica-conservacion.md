# Política de conservación de registros fiscales

> **Fundamento:** Providencia Administrativa SNAT/2024/000102, Artículo 18, numeral 7:
> el emisor debe garantizar al SENIAT *"acceso permanente para consultar los
> documentos emitidos por diez (10) años"* — **esta obligación sigue plenamente
> vigente, es del emisor y no fue tocada por la derogatoria del 12/08/2026**. Y la
> Providencia SNAT/2024/000121 —hoy derogada—,
> Artículo 3 literal a: *"conservación, accesibilidad, legibilidad"* de los registros.
>
> **Estado:** vigente. Última revisión: 09/08/2026.

---

## 1 · Principio

**Los registros fiscales no se eliminan.** No hay purga por antigüedad, ni archivado
que los saque de línea, ni procedimiento de depuración. Un documento emitido en 2026
se consulta en 2036 con la misma consulta que hoy.

Esto no es una promesa operativa: **está impuesto por la estructura de la base de
datos.** En las empresas en modo factura, los disparadores de inalterabilidad
rechazan toda eliminación sobre `libro_fiscal`, `facturas`, `retenciones` y
`documentos_fiscales`. No existe una ruta —ni por la interfaz, ni por la API— que
borre un registro fiscal.

---

## 2 · Qué se conserva

| Registro | Tabla | Contenido |
|---|---|---|
| Libros de compras y ventas | `libro_fiscal` | Toda operación declarada, con su desglose por alícuota |
| Documentos emitidos | `facturas` | Facturas, notas de crédito y de débito, con el vínculo entre ellas |
| Comprobantes de retención | `retenciones` | IVA e ISLR, practicadas y sufridas |
| Asientos contables | `asientos` | Contabilidad completa |
| Bóveda de documentos | `documentos_fiscales` | Declaraciones, planillas y comprobantes en archivo |
| **Registro de eventos** | `eventos_sistema` | Quién hizo qué, cuándo, y el estado antes y después |
| **Consultas del SENIAT** | `consultas_seniat` | Quién consultó, qué y cuándo |

Los dos últimos son parte de la conservación, no accesorios: el literal h del
Artículo 3 obliga a dar acceso *"a los registros fiscales y de eventos"*.

---

## 3 · Dónde vive cada copia

La conservación descansa en tres niveles, y conviene no confundirlos. **Un respaldo
no es conservación**: el respaldo protege de un desastre; la conservación protege del
tiempo.

### Nivel 1 · La base en producción

PostgreSQL 15 en Supabase. Es la copia viva y la que responde las consultas. **Los
registros permanecen aquí de forma indefinida**, sin límite de antigüedad.

### Nivel 2 · Respaldo del proveedor de infraestructura

Respaldos automáticos diarios y recuperación por punto en el tiempo, gestionados por
Supabase. **Su retención es de días, no de años.** Sirven para recuperarse de un
error operativo o una falla, no para cumplir los diez años.

### Nivel 3 · Archivo independiente de largo plazo

Exportación **mensual** de las tablas fiscales completas, en formato abierto,
almacenada fuera de la infraestructura del proveedor de base de datos.

**Por qué existe este nivel.** Los niveles 1 y 2 comparten un punto único de falla: si
el proveedor de infraestructura desaparece, cambia sus condiciones o cierra la cuenta,
se pierden ambos a la vez. Diez años son más de lo que dura la mayoría de los
contratos de servicio. El archivo independiente es lo único que hace la obligación
sostenible en ese plazo.

| | |
|---|---|
| **Frecuencia** | Mensual, tras el cierre del período fiscal |
| **Formato** | CSV y JSON — abiertos, legibles sin el software que los produjo |
| **Alcance** | Las siete tablas de la sección 2, completas |
| **Destino** | Almacenamiento independiente del proveedor de base de datos |
| **Verificación** | Resumen criptográfico por archivo, para detectar alteración |
| **Responsable** | El proveedor del sistema |

**Legibilidad a diez años.** El formato importa tanto como la copia. Un respaldo en
formato propietario es ilegible cuando el software que lo creó ya no existe; CSV y
JSON se leen con cualquier herramienta, hoy y dentro de una década.

---

## 4 · Acceso del SENIAT durante los diez años

El acceso no depende de que el proveedor atienda una solicitud: es directo, mediante
la **API de consulta** descrita en la ficha técnica.

Cada empresa autorizada tiene su propia clave. Con ella, el SENIAT consulta libros,
documentos, retenciones y el registro de eventos, por período, sin intermediación.
Las claves no vencen; se revocan solo por decisión expresa, y cada consulta queda
registrada.

---

## 5 · Qué pasa si un cliente deja de usar el sistema

Un contribuyente que cancela su suscripción **no pierde ni borra sus registros**. La
obligación de conservar es suya y se extiende diez años, con independencia de que
siga siendo cliente.

| | |
|---|---|
| **Los datos** | Permanecen en el sistema. No se eliminan al cancelar |
| **Entrega** | Se le entrega la exportación completa en formato abierto |
| **Consulta del SENIAT** | La clave de consulta de esa empresa sigue activa |

**Eliminar los datos de un cliente que se va sería trasladarle a él —y al proveedor—
un incumplimiento.** Existe un procedimiento de eliminación por cuenta
(`sql/blindaje_db.sql`), reservado para casos excepcionales y a solicitud expresa del
titular; no forma parte de la baja ordinaria del servicio.

---

## 6 · Pendiente

| Punto | Situación |
|---|---|
| Automatizar la exportación mensual | Por construir. La infraestructura de automatización (n8n) está operativa; falta el flujo y el destino de archivo |
| Definir el destino del archivo independiente | Por decidir: almacenamiento en la nube distinto del proveedor de base de datos, o medio físico bajo custodia |
| Prueba de restauración | Por establecer. Un respaldo que nunca se restauró es una suposición, no un respaldo. Se propone una prueba anual documentada |
