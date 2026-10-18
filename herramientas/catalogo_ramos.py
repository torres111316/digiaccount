# -*- coding: utf-8 -*-
"""LISTA DE PRODUCTOS SUGERIDA POR RAMO  →  sql/catalogo_ramos.sql

    python herramientas/catalogo_ramos.py

Cada renglón es  nombre | categoría | unidad | alícuota
  unidad:   und, kg, g, L, ml, m, caja, bulto, doc  (kg = se vende por peso)
  alícuota: E   exento (Ley del IVA, art. 18)
            16  alícuota general
            E?  exento, pero conviene que el contador lo confirme
            16? general, pero conviene que el contador lo confirme

Los productos nacen SIN precio, sin costo y sin existencia: cada negocio pone
los suyos. Son nombres genéricos (sin marca) para que el dueño los ajuste.
Si cambias esta lista, vuelve a correr el script y luego el SQL.
"""
import io, os, re

CAT = {}

CAT['bodega'] = """
Harina de maíz precocida 1 kg | Víveres | und | E
Arroz blanco 1 kg | Víveres | und | E
Pasta larga 1 kg | Víveres | und | E
Pasta corta 1 kg | Víveres | und | E
Pasta 500 g | Víveres | und | E
Azúcar 1 kg | Víveres | und | E
Sal 1 kg | Víveres | und | E
Café molido 250 g | Víveres | und | E
Café molido 500 g | Víveres | und | E
Aceite vegetal 1 L | Víveres | und | E
Aceite vegetal 500 ml | Víveres | und | E
Margarina 500 g | Víveres | und | E
Margarina 250 g | Víveres | und | E
Mayonesa 445 g | Víveres | und | E
Mayonesa 175 g | Víveres | und | E
Avena en hojuelas 400 g | Víveres | und | E
Leche en polvo 400 g | Víveres | und | E
Leche en polvo 900 g | Víveres | und | E
Leche líquida 1 L | Víveres | und | E
Caraotas negras 500 g | Granos | und | E
Caraotas rojas 500 g | Granos | und | E
Lentejas 500 g | Granos | und | E
Arvejas 500 g | Granos | und | E
Frijoles 500 g | Granos | und | E
Garbanzos 500 g | Granos | und | E
Huevos (cartón de 30) | Víveres | und | E
Huevos (medio cartón) | Víveres | und | E
Sardinas en salsa de tomate 170 g | Enlatados | und | E
Atún en agua 140 g | Enlatados | und | E
Atún en aceite 140 g | Enlatados | und | 16?
Mortadela 1 kg | Charcutería | kg | E
Salsa de tomate 397 g | Salsas y aliños | und | 16
Mostaza 200 g | Salsas y aliños | und | 16
Salsa de soya 150 ml | Salsas y aliños | und | 16
Vinagre 1 L | Salsas y aliños | und | 16
Adobo 200 g | Salsas y aliños | und | 16
Comino 50 g | Salsas y aliños | und | 16
Onoto 50 g | Salsas y aliños | und | 16
Cubitos de caldo (caja) | Salsas y aliños | und | 16
Harina de trigo 1 kg | Víveres | und | E
Harina de trigo leudante 1 kg | Víveres | und | E
Papelón (panela) | Víveres | und | E
Maicena 200 g | Víveres | und | 16
Gelatina en polvo | Víveres | und | 16
Galletas de soda (paquete) | Galletas y dulces | und | 16
Galletas dulces (paquete) | Galletas y dulces | und | 16
Galletas de chocolate (paquete) | Galletas y dulces | und | 16
Chocolate de taza | Galletas y dulces | und | 16
Caramelos (bolsa) | Galletas y dulces | und | 16
Chupetas | Galletas y dulces | und | 16
Chicles | Galletas y dulces | und | 16
Papitas fritas (bolsa) | Snacks | und | 16
Tostones de plátano (bolsa) | Snacks | und | 16
Maní salado (bolsa) | Snacks | und | 16
Cotufas (bolsa) | Snacks | und | 16
Refresco 2 L | Bebidas | und | 16
Refresco 1,5 L | Bebidas | und | 16
Refresco lata 355 ml | Bebidas | und | 16
Malta 250 ml | Bebidas | und | 16
Agua mineral 600 ml | Bebidas | und | 16
Agua potable 5 L | Bebidas | und | 16
Jugo pasteurizado 1 L | Bebidas | und | 16
Bebida achocolatada 250 ml | Bebidas | und | 16
Bebida energizante | Bebidas | und | 16
Cerveza lata 355 ml | Licores | und | 16?
Cerveza botella 222 ml | Licores | und | 16?
Pan de sándwich | Panadería | und | 16?
Pan canilla | Panadería | und | E
Cigarrillos (cajetilla) | Cigarrillos | und | 16?
Fósforos (caja) | Hogar | und | 16
Jabón de baño | Cuidado personal | und | 16
Champú 400 ml | Cuidado personal | und | 16
Crema dental 100 ml | Cuidado personal | und | 16
Cepillo dental | Cuidado personal | und | 16
Desodorante | Cuidado personal | und | 16
Toallas sanitarias (paquete) | Cuidado personal | und | 16
Pañales (paquete) | Cuidado personal | und | 16
Papel higiénico (paquete de 4) | Hogar | und | 16
Servilletas (paquete) | Hogar | und | 16
Jabón en polvo 1 kg | Limpieza | und | 16
Jabón en panela | Limpieza | und | 16
Lavaplatos en crema | Limpieza | und | 16
Cloro 1 L | Limpieza | und | 16
Desinfectante 1 L | Limpieza | und | 16
Suavizante 1 L | Limpieza | und | 16
Esponja de fregar | Limpieza | und | 16
Bolsas para basura (paquete) | Limpieza | und | 16
Velas | Hogar | und | 16
Pilas AA (par) | Hogar | und | 16
Bombillo LED | Hogar | und | 16
Gas doméstico (bombona) | Hogar | und | E?
Hielo (bolsa) | Bebidas | und | 16
Queso blanco duro | Charcutería | kg | E
Plátano | Frutas y verduras | kg | E
Cebolla | Frutas y verduras | kg | E
Tomate | Frutas y verduras | kg | E
Papa | Frutas y verduras | kg | E
"""

# El abasto lleva lo de la bodega y además surtido de supermercado
CAT['abasto'] = CAT['bodega'] + """
Harina de maíz precocida amarilla 1 kg | Víveres | und | E
Arroz parbolizado 1 kg | Víveres | und | E
Pasta integral 500 g | Víveres | und | E
Aceite de oliva 500 ml | Víveres | und | 16
Leche descremada 1 L | Víveres | und | E
Leche condensada 395 g | Víveres | und | 16
Crema de leche 250 ml | Víveres | und | 16
Cereal de maíz 500 g | Desayuno | und | 16
Cereal azucarado 300 g | Desayuno | und | 16
Mermelada 300 g | Desayuno | und | 16
Diablitos 115 g | Enlatados | und | 16
Maíz dulce en lata | Enlatados | und | 16
Salchichas en lata | Enlatados | und | 16
Duraznos en almíbar | Enlatados | und | 16
Pasta de tomate | Salsas y aliños | und | 16
Salsa para pasta 490 g | Salsas y aliños | und | 16
Salsa inglesa | Salsas y aliños | und | 16
Pimienta molida | Salsas y aliños | und | 16
Ajo en polvo | Salsas y aliños | und | 16
Té en sobres (caja) | Bebidas | und | 16
Jugo en polvo (sobre) | Bebidas | und | 16
Yogur 1 L | Lácteos | und | 16?
Queso amarillo rebanado | Charcutería | kg | 16
Jamón de pierna | Charcutería | kg | 16
Pechuga de pollo | Carnes | kg | E
Carne molida de res | Carnes | kg | E
Alimento para perros 2 kg | Mascotas | und | 16?
Alimento para gatos 1 kg | Mascotas | und | 16?
Arena para gatos | Mascotas | und | 16
Papel aluminio | Hogar | und | 16
Papel envoplast | Hogar | und | 16
Vasos desechables (paquete) | Desechables | und | 16
Platos desechables (paquete) | Desechables | und | 16
Cubiertos desechables (paquete) | Desechables | und | 16
Insecticida en aerosol | Limpieza | und | 16
Limpiavidrios | Limpieza | und | 16
Toallas de cocina (rollo) | Hogar | und | 16
Afeitadora desechable | Cuidado personal | und | 16
Crema corporal | Cuidado personal | und | 16
Toallitas húmedas | Cuidado personal | und | 16
"""

CAT['ferreteria'] = """
Clavos de 1 pulgada | Fijación | kg | 16
Clavos de 2 pulgadas | Fijación | kg | 16
Clavos de 3 pulgadas | Fijación | kg | 16
Clavos de acero | Fijación | und | 16
Tornillos para madera (caja) | Fijación | caja | 16
Tornillos para drywall (caja) | Fijación | caja | 16
Tornillos autorroscantes | Fijación | und | 16
Tuercas | Fijación | und | 16
Arandelas | Fijación | und | 16
Pernos con tuerca | Fijación | und | 16
Ramplug (tacos plásticos) | Fijación | und | 16
Brocas para concreto | Herramientas | und | 16
Brocas para metal | Herramientas | und | 16
Brocas para madera | Herramientas | und | 16
Martillo | Herramientas | und | 16
Destornillador plano | Herramientas | und | 16
Destornillador estría | Herramientas | und | 16
Juego de destornilladores | Herramientas | und | 16
Alicate universal | Herramientas | und | 16
Alicate de presión | Herramientas | und | 16
Llave ajustable | Herramientas | und | 16
Juego de llaves combinadas | Herramientas | und | 16
Llave de tubo | Herramientas | und | 16
Cinta métrica 5 m | Herramientas | und | 16
Nivel | Herramientas | und | 16
Segueta | Herramientas | und | 16
Hoja de segueta | Herramientas | und | 16
Serrucho | Herramientas | und | 16
Pala | Herramientas | und | 16
Pico | Herramientas | und | 16
Carretilla | Herramientas | und | 16
Machete | Herramientas | und | 16
Escalera | Herramientas | und | 16
Taladro eléctrico | Herramientas eléctricas | und | 16
Esmeril angular | Herramientas eléctricas | und | 16
Disco de corte | Herramientas eléctricas | und | 16
Disco de desbaste | Herramientas eléctricas | und | 16
Electrodos (kg) | Soldadura | kg | 16
Cemento gris (saco 42,5 kg) | Construcción | bulto | 16
Cemento blanco 1 kg | Construcción | und | 16
Cal | Construcción | bulto | 16
Arena lavada | Construcción | bulto | 16
Piedra picada | Construcción | bulto | 16
Bloque de arcilla | Construcción | und | 16
Bloque de cemento | Construcción | und | 16
Cabilla 3/8 | Construcción | und | 16
Cabilla 1/2 | Construcción | und | 16
Alambre dulce | Construcción | kg | 16
Malla truckson | Construcción | und | 16
Pego para cerámica | Construcción | bulto | 16
Porcelana para juntas | Construcción | und | 16
Impermeabilizante | Construcción | und | 16
Tubo PVC 1/2 (agua) | Plomería | und | 16
Tubo PVC 3/4 (agua) | Plomería | und | 16
Tubo PVC 2 pulgadas (aguas negras) | Plomería | und | 16
Tubo PVC 4 pulgadas (aguas negras) | Plomería | und | 16
Codo PVC 1/2 | Plomería | und | 16
Tee PVC 1/2 | Plomería | und | 16
Unión PVC 1/2 | Plomería | und | 16
Llave de paso 1/2 | Plomería | und | 16
Grifo de lavamanos | Plomería | und | 16
Grifo de fregadero | Plomería | und | 16
Pegamento para PVC | Plomería | und | 16
Teflón | Plomería | und | 16
Flotante para tanque | Plomería | und | 16
Manguera de jardín | Plomería | m | 16
Cable eléctrico número 12 | Electricidad | m | 16
Cable eléctrico número 14 | Electricidad | m | 16
Cable eléctrico número 10 | Electricidad | m | 16
Tomacorriente doble | Electricidad | und | 16
Interruptor sencillo | Electricidad | und | 16
Interruptor doble | Electricidad | und | 16
Breaker 20 A | Electricidad | und | 16
Breaker 30 A | Electricidad | und | 16
Caja de paso | Electricidad | und | 16
Tubo conduit | Electricidad | und | 16
Bombillo LED 9 W | Electricidad | und | 16
Bombillo LED 15 W | Electricidad | und | 16
Socate | Electricidad | und | 16
Cinta aislante | Electricidad | und | 16
Extensión eléctrica | Electricidad | und | 16
Pintura de caucho (galón) | Pintura | und | 16
Pintura de caucho (cuñete) | Pintura | und | 16
Pintura de aceite (galón) | Pintura | und | 16
Esmalte en spray | Pintura | und | 16
Fondo antióxido | Pintura | und | 16
Thinner (litro) | Pintura | L | 16
Brocha 2 pulgadas | Pintura | und | 16
Brocha 4 pulgadas | Pintura | und | 16
Rodillo | Pintura | und | 16
Bandeja para pintura | Pintura | und | 16
Lija de agua | Pintura | und | 16
Lija para madera | Pintura | und | 16
Masilla | Pintura | und | 16
Candado | Cerrajería | und | 16
Cerradura de puerta | Cerrajería | und | 16
Bisagra | Cerrajería | und | 16
Pasador | Cerrajería | und | 16
Silicón transparente | Adhesivos | und | 16
Pega blanca | Adhesivos | und | 16
Pega epóxica | Adhesivos | und | 16
Cinta de embalar | Adhesivos | und | 16
Guantes de trabajo | Seguridad | und | 16
Lentes de seguridad | Seguridad | und | 16
Tapabocas | Seguridad | und | 16
"""

CAT['carniceria'] = """
Carne de res para bistec | Res | kg | E
Carne molida de res | Res | kg | E
Carne de segunda (para guisar) | Res | kg | E
Pulpa negra | Res | kg | E
Solomo de cuerito | Res | kg | E
Punta trasera | Res | kg | E
Lomito | Res | kg | E
Costilla de res | Res | kg | E
Falda | Res | kg | E
Osobuco | Res | kg | E
Hueso de res (para sopa) | Res | kg | E
Rabo de res | Res | kg | E
Hígado de res | Vísceras | kg | E
Mondongo | Vísceras | kg | E
Pata de res | Vísceras | kg | E
Chuleta de cerdo | Cerdo | kg | E
Pernil de cerdo | Cerdo | kg | E
Costilla de cerdo | Cerdo | kg | E
Carne de cerdo molida | Cerdo | kg | E
Chicharrón | Cerdo | kg | 16?
Tocino | Cerdo | kg | 16?
Pollo entero | Pollo | kg | E
Pechuga de pollo | Pollo | kg | E
Muslo de pollo | Pollo | kg | E
Alas de pollo | Pollo | kg | E
Milanesa de pollo | Pollo | kg | E
Molleja de pollo | Pollo | kg | E
Carne de chivo | Chivo y ovejo | kg | E
Carne de ovejo | Chivo y ovejo | kg | E
Chorizo | Embutidos | kg | 16
Morcilla | Embutidos | kg | 16
Salchicha | Embutidos | kg | 16
Pescado entero (fresco) | Pescadería | kg | E?
Filete de pescado | Pescadería | kg | E?
Camarones | Pescadería | kg | 16?
Huevos (cartón de 30) | Otros | und | E
Carbón (saco) | Otros | und | 16
"""

CAT['charcuteria'] = """
Jamón de pierna | Jamones | kg | 16
Jamón de espalda | Jamones | kg | 16
Jamón de pavo | Jamones | kg | 16
Jamón serrano | Jamones | kg | 16
Mortadela | Embutidos | kg | E
Mortadela especial | Embutidos | kg | E?
Salchichón | Embutidos | kg | 16
Salami | Embutidos | kg | 16
Pepperoni | Embutidos | kg | 16
Chorizo | Embutidos | kg | 16
Salchicha de pollo | Embutidos | kg | 16
Salchicha de cerdo | Embutidos | kg | 16
Tocineta | Embutidos | kg | 16
Pechuga de pavo ahumada | Embutidos | kg | 16
Queso blanco duro | Quesos | kg | E
Queso blanco suave | Quesos | kg | 16?
Queso guayanés | Quesos | kg | 16?
Queso de mano | Quesos | kg | 16?
Queso telita | Quesos | kg | 16?
Queso palmita | Quesos | kg | 16?
Queso de año | Quesos | kg | 16?
Queso amarillo | Quesos | kg | 16
Queso mozzarella | Quesos | kg | 16
Queso parmesano | Quesos | kg | 16
Queso crema | Quesos | und | 16
Natilla | Lácteos | kg | 16?
Mantequilla | Lácteos | und | E
Margarina | Lácteos | und | E
Huevos (cartón de 30) | Otros | und | E
Aceitunas | Delicateses | kg | 16
Encurtidos | Delicateses | und | 16
Pan de sándwich | Panadería | und | 16?
"""

CAT['lacteos'] = """
Queso blanco duro | Quesos | kg | E
Queso blanco suave | Quesos | kg | 16?
Queso guayanés | Quesos | kg | 16?
Queso de mano | Quesos | kg | 16?
Queso telita | Quesos | kg | 16?
Queso palmita | Quesos | kg | 16?
Queso de año | Quesos | kg | 16?
Queso pasteurizado | Quesos | kg | 16?
Queso amarillo | Quesos | kg | 16
Queso mozzarella | Quesos | kg | 16
Natilla | Lácteos | kg | 16?
Suero | Lácteos | und | 16?
Crema de leche | Lácteos | und | 16
Mantequilla | Lácteos | und | E
Leche líquida 1 L | Lácteos | und | E
Leche cruda | Lácteos | L | E
Yogur | Lácteos | und | 16?
Huevos (cartón de 30) | Otros | und | E
"""

CAT['verduleria'] = """
Tomate | Hortalizas | kg | E
Cebolla blanca | Hortalizas | kg | E
Cebolla morada | Hortalizas | kg | E
Pimentón | Hortalizas | kg | E
Ají dulce | Hortalizas | kg | E
Ajo | Hortalizas | kg | E
Papa | Tubérculos | kg | E
Yuca | Tubérculos | kg | E
Ñame | Tubérculos | kg | E
Ocumo | Tubérculos | kg | E
Batata | Tubérculos | kg | E
Zanahoria | Hortalizas | kg | E
Remolacha | Hortalizas | kg | E
Auyama | Hortalizas | kg | E
Calabacín | Hortalizas | kg | E
Berenjena | Hortalizas | kg | E
Pepino | Hortalizas | kg | E
Repollo | Hortalizas | kg | E
Lechuga | Hortalizas | und | E
Brócoli | Hortalizas | kg | E
Coliflor | Hortalizas | kg | E
Vainitas | Hortalizas | kg | E
Maíz tierno (jojoto) | Hortalizas | und | E
Cilantro (manojo) | Verduras de hoja | und | E
Perejil (manojo) | Verduras de hoja | und | E
Cebollín (manojo) | Verduras de hoja | und | E
Ajo porro | Verduras de hoja | und | E
Célery | Verduras de hoja | und | E
Espinaca | Verduras de hoja | und | E
Plátano verde | Plátanos | kg | E
Plátano maduro | Plátanos | kg | E
Cambur | Frutas | kg | E
Topocho | Plátanos | kg | E
Naranja | Frutas | kg | E
Mandarina | Frutas | kg | E
Limón | Frutas | kg | E
Lechosa | Frutas | kg | E
Patilla | Frutas | kg | E
Melón | Frutas | kg | E
Piña | Frutas | und | E
Mango | Frutas | kg | E
Guayaba | Frutas | kg | E
Parchita | Frutas | kg | E
Guanábana | Frutas | kg | E
Aguacate | Frutas | kg | E
Fresa | Frutas | kg | E
Manzana | Frutas | kg | E
Pera | Frutas | kg | E
Uva | Frutas | kg | E
Coco | Frutas | und | E
Tamarindo | Frutas | kg | E
"""

CAT['agropecuaria'] = """
Alimento concentrado para ganado (saco) | Alimentos para animales | bulto | 16?
Alimento para pollos de engorde (saco) | Alimentos para animales | bulto | 16?
Alimento para gallinas ponedoras (saco) | Alimentos para animales | bulto | 16?
Alimento para cerdos (saco) | Alimentos para animales | bulto | 16?
Alimento para perros (saco) | Alimentos para animales | bulto | 16?
Alimento para gatos (saco) | Alimentos para animales | bulto | 16?
Maíz amarillo (saco) | Alimentos para animales | bulto | E?
Sal mineralizada para ganado | Alimentos para animales | bulto | 16?
Melaza | Alimentos para animales | L | 16?
Urea (saco) | Fertilizantes | bulto | E?
Fertilizante 15-15-15 (saco) | Fertilizantes | bulto | E?
Fertilizante 12-24-12 (saco) | Fertilizantes | bulto | E?
Fertilizante foliar | Fertilizantes | L | E?
Abono orgánico (saco) | Fertilizantes | bulto | E?
Cal agrícola (saco) | Fertilizantes | bulto | 16?
Herbicida (litro) | Agroquímicos | L | E?
Insecticida agrícola (litro) | Agroquímicos | L | E?
Fungicida (litro) | Agroquímicos | L | E?
Semilla de maíz (saco) | Semillas | bulto | E?
Semilla de hortalizas (sobre) | Semillas | und | E?
Semilla de pasto | Semillas | kg | E?
Ivermectina | Medicina veterinaria | und | E?
Vacuna para ganado | Medicina veterinaria | und | E?
Antibiótico veterinario | Medicina veterinaria | und | E?
Vitaminas veterinarias | Medicina veterinaria | und | E?
Desparasitante veterinario | Medicina veterinaria | und | E?
Jeringa desechable | Medicina veterinaria | und | 16
Bomba fumigadora de espalda | Herramientas | und | 16
Machete | Herramientas | und | 16
Pala | Herramientas | und | 16
Escardilla | Herramientas | und | 16
Carretilla | Herramientas | und | 16
Alambre de púas (rollo) | Cercas | und | 16
Grapas para cerca | Cercas | kg | 16
Manguera de riego | Riego | m | 16
Botas de goma | Seguridad | und | 16
Guantes de trabajo | Seguridad | und | 16
Saco de polipropileno | Empaques | und | 16
"""

CAT['farmacia'] = """
Acetaminofén 500 mg (caja) | Analgésicos | und | E
Ibuprofeno 400 mg (caja) | Analgésicos | und | E
Diclofenac 50 mg (caja) | Analgésicos | und | E
Aspirina 100 mg (caja) | Analgésicos | und | E
Metamizol (caja) | Analgésicos | und | E
Amoxicilina 500 mg (caja) | Antibióticos | und | E
Azitromicina 500 mg (caja) | Antibióticos | und | E
Ciprofloxacina 500 mg (caja) | Antibióticos | und | E
Cefalexina 500 mg (caja) | Antibióticos | und | E
Loratadina 10 mg (caja) | Antialérgicos | und | E
Cetirizina 10 mg (caja) | Antialérgicos | und | E
Losartán 50 mg (caja) | Tensión y corazón | und | E
Enalapril 10 mg (caja) | Tensión y corazón | und | E
Amlodipina 5 mg (caja) | Tensión y corazón | und | E
Metformina 850 mg (caja) | Diabetes | und | E
Glibenclamida 5 mg (caja) | Diabetes | und | E
Omeprazol 20 mg (caja) | Digestivos | und | E
Ranitidina (caja) | Digestivos | und | E
Sales de rehidratación oral | Digestivos | und | E
Antiácido (frasco) | Digestivos | und | E
Jarabe para la tos | Respiratorios | und | E
Salbutamol inhalador | Respiratorios | und | E
Complejo B (caja) | Vitaminas | und | E?
Vitamina C (caja) | Vitaminas | und | E?
Ácido fólico (caja) | Vitaminas | und | E
Suero fisiológico 500 ml | Material médico | und | E
Alcohol isopropílico | Material médico | und | 16?
Agua oxigenada | Material médico | und | 16?
Algodón | Material médico | und | 16?
Gasas (paquete) | Material médico | und | 16?
Curitas (caja) | Material médico | und | 16?
Adhesivo médico | Material médico | und | 16?
Jeringas desechables | Material médico | und | 16?
Termómetro digital | Material médico | und | 16
Tensiómetro | Material médico | und | 16
Tapabocas (caja) | Material médico | und | 16
Guantes de látex (caja) | Material médico | und | 16
Preservativos | Cuidado personal | und | 16?
Prueba de embarazo | Material médico | und | 16?
Toallas sanitarias | Cuidado personal | und | 16
Pañales (paquete) | Cuidado personal | und | 16
Fórmula láctea infantil | Infantil | und | E
Protector solar | Cuidado personal | und | 16
Champú | Cuidado personal | und | 16
Crema dental | Cuidado personal | und | 16
Desodorante | Cuidado personal | und | 16
"""

CAT['repuestos'] = """
Aceite de motor 15W40 (litro) | Lubricantes | und | 16
Aceite de motor 20W50 (litro) | Lubricantes | und | 16
Aceite de motor sintético 5W30 (litro) | Lubricantes | und | 16
Aceite de caja automática (litro) | Lubricantes | und | 16
Aceite hidráulico (litro) | Lubricantes | und | 16
Líquido de frenos | Lubricantes | und | 16
Refrigerante (galón) | Lubricantes | und | 16
Grasa (kg) | Lubricantes | und | 16
Filtro de aceite | Filtros | und | 16
Filtro de aire | Filtros | und | 16
Filtro de gasolina | Filtros | und | 16
Filtro de aire acondicionado | Filtros | und | 16
Pastillas de freno delanteras | Frenos | und | 16
Bandas de freno traseras | Frenos | und | 16
Disco de freno | Frenos | und | 16
Bomba de freno | Frenos | und | 16
Bujías (juego) | Encendido | und | 16
Cables de bujía (juego) | Encendido | und | 16
Bobina de encendido | Encendido | und | 16
Batería 12 V | Eléctrico | und | 16
Bombillo de faro | Eléctrico | und | 16
Bombillo de stop | Eléctrico | und | 16
Fusibles (caja) | Eléctrico | und | 16
Alternador | Eléctrico | und | 16
Motor de arranque | Eléctrico | und | 16
Correa de tiempo | Motor | und | 16
Correa de accesorios | Motor | und | 16
Kit de tiempo | Motor | und | 16
Bomba de agua | Motor | und | 16
Termostato | Motor | und | 16
Empacadura de culata | Motor | und | 16
Juego de empacaduras | Motor | und | 16
Radiador | Enfriamiento | und | 16
Manguera de radiador | Enfriamiento | und | 16
Electroventilador | Enfriamiento | und | 16
Amortiguador delantero | Suspensión | und | 16
Amortiguador trasero | Suspensión | und | 16
Terminal de dirección | Suspensión | und | 16
Rótula | Suspensión | und | 16
Muñón | Suspensión | und | 16
Buje de meseta | Suspensión | und | 16
Kit de embrague | Transmisión | und | 16
Tripoide | Transmisión | und | 16
Bomba de gasolina | Combustible | und | 16
Inyector | Combustible | und | 16
Limpiaparabrisas (par) | Accesorios | und | 16
Caucho rin 13 | Cauchos | und | 16
Caucho rin 14 | Cauchos | und | 16
Caucho rin 15 | Cauchos | und | 16
Caucho rin 16 | Cauchos | und | 16
Tripa | Cauchos | und | 16
Abrazaderas | Ferretería | und | 16
"""

CAT['repuestos_moto'] = """
Aceite para moto 4T 20W50 (litro) | Lubricantes | und | 16
Aceite para moto 2T (litro) | Lubricantes | und | 16
Filtro de aceite para moto | Filtros | und | 16
Filtro de aire para moto | Filtros | und | 16
Bujía para moto | Encendido | und | 16
Kit de arrastre (cadena, piñón y corona) | Transmisión | und | 16
Cadena | Transmisión | und | 16
Piñón | Transmisión | und | 16
Corona | Transmisión | und | 16
Pastillas de freno para moto | Frenos | und | 16
Bandas de freno para moto | Frenos | und | 16
Guaya de freno | Guayas | und | 16
Guaya de clutch | Guayas | und | 16
Guaya de acelerador | Guayas | und | 16
Batería para moto 12 V | Eléctrico | und | 16
Bombillo de faro para moto | Eléctrico | und | 16
Direccionales (par) | Eléctrico | und | 16
Regulador de voltaje | Eléctrico | und | 16
CDI | Eléctrico | und | 16
Caucho delantero para moto | Cauchos | und | 16
Caucho trasero para moto | Cauchos | und | 16
Tripa para moto | Cauchos | und | 16
Retrovisores (par) | Accesorios | und | 16
Manillas (par) | Accesorios | und | 16
Casco | Accesorios | und | 16
Carburador | Motor | und | 16
Kit de pistón | Motor | und | 16
Discos de clutch | Motor | und | 16
Empacaduras de motor | Motor | und | 16
Amortiguador trasero para moto | Suspensión | und | 16
Barras de suspensión | Suspensión | und | 16
Rolineras | Suspensión | und | 16
"""

CAT['panaderia'] = """
Pan canilla | Pan salado | und | E
Pan francés | Pan salado | und | E
Pan campesino | Pan salado | und | E
Pan de sándwich | Pan salado | und | 16?
Pan integral | Pan salado | und | E?
Pan dulce | Pan dulce | und | 16?
Pan de jamón | Pan dulce | und | 16
Golfeados | Pastelería | und | 16
Cachitos | Pastelería | und | 16
Croissants | Pastelería | und | 16
Pañuelitos | Pastelería | und | 16
Cachito de jamón | Pastelería | und | 16
Torta (porción) | Pastelería | und | 16
Torta completa | Pastelería | und | 16
Quesillo (porción) | Pastelería | und | 16
Tequeños (docena) | Pastelería | doc | 16
Pastelitos | Pastelería | und | 16
Empanadas | Comida | und | 16
Café negro | Bebidas | und | 16
Café con leche | Bebidas | und | 16
Jugo natural | Bebidas | und | 16
Refresco | Bebidas | und | 16
Agua mineral | Bebidas | und | 16
Leche líquida 1 L | Víveres | und | E
Queso blanco duro | Charcutería | kg | E
Jamón | Charcutería | kg | 16
Mantequilla | Víveres | und | E
Huevos (cartón de 30) | Víveres | und | E
"""

CAT['licoreria'] = """
Cerveza lata 355 ml | Cervezas | und | 16?
Cerveza botella 222 ml | Cervezas | und | 16?
Cerveza (caja de 36) | Cervezas | caja | 16?
Cerveza importada | Cervezas | und | 16?
Ron añejo 0,75 L | Rones | und | 16?
Ron blanco 0,75 L | Rones | und | 16?
Ron 1,75 L | Rones | und | 16?
Whisky 0,75 L | Whisky | und | 16?
Whisky 1 L | Whisky | und | 16?
Vodka 0,75 L | Vodka | und | 16?
Ginebra 0,75 L | Otros licores | und | 16?
Tequila 0,75 L | Otros licores | und | 16?
Anís 0,75 L | Otros licores | und | 16?
Sangría 1 L | Vinos | und | 16?
Vino tinto 0,75 L | Vinos | und | 16?
Vino blanco 0,75 L | Vinos | und | 16?
Espumante 0,75 L | Vinos | und | 16?
Refresco 2 L | Mezcladores | und | 16
Agua tónica | Mezcladores | und | 16
Soda | Mezcladores | und | 16
Agua mineral 600 ml | Mezcladores | und | 16
Bebida energizante | Mezcladores | und | 16
Hielo (bolsa) | Otros | und | 16
Vasos desechables (paquete) | Otros | und | 16
Cigarrillos (cajetilla) | Cigarrillos | und | 16?
Papitas fritas (bolsa) | Pasapalos | und | 16
Maní salado (bolsa) | Pasapalos | und | 16
Tostones de plátano (bolsa) | Pasapalos | und | 16
"""

CAT['perfumeria'] = """
Champú | Cabello | und | 16
Acondicionador | Cabello | und | 16
Crema para peinar | Cabello | und | 16
Tinte para cabello | Cabello | und | 16
Gel para cabello | Cabello | und | 16
Jabón de baño | Cuerpo | und | 16
Gel de baño | Cuerpo | und | 16
Crema corporal | Cuerpo | und | 16
Desodorante | Cuerpo | und | 16
Protector solar | Cuerpo | und | 16
Perfume de dama | Perfumes | und | 16
Perfume de caballero | Perfumes | und | 16
Colonia | Perfumes | und | 16
Base de maquillaje | Maquillaje | und | 16
Polvo compacto | Maquillaje | und | 16
Labial | Maquillaje | und | 16
Pestañina | Maquillaje | und | 16
Delineador | Maquillaje | und | 16
Sombras | Maquillaje | und | 16
Desmaquillante | Maquillaje | und | 16
Esmalte de uñas | Uñas | und | 16
Quitaesmalte | Uñas | und | 16
Lima de uñas | Uñas | und | 16
Crema facial | Rostro | und | 16
Toallitas desmaquillantes | Rostro | und | 16
Crema dental | Higiene | und | 16
Cepillo dental | Higiene | und | 16
Enjuague bucal | Higiene | und | 16
Afeitadora desechable | Higiene | und | 16
Espuma de afeitar | Higiene | und | 16
Toallas sanitarias | Higiene | und | 16
"""

CAT['libreria'] = """
Cuaderno de una línea | Cuadernos | und | 16?
Cuaderno doble línea | Cuadernos | und | 16?
Cuaderno cuadriculado | Cuadernos | und | 16?
Cuaderno de dibujo | Cuadernos | und | 16?
Lápiz de grafito | Escritura | und | 16
Bolígrafo azul | Escritura | und | 16
Bolígrafo negro | Escritura | und | 16
Bolígrafo rojo | Escritura | und | 16
Marcador permanente | Escritura | und | 16
Marcador de pizarra | Escritura | und | 16
Resaltador | Escritura | und | 16
Corrector líquido | Escritura | und | 16
Borrador | Escritura | und | 16
Sacapuntas | Escritura | und | 16
Colores (caja de 12) | Arte | und | 16
Creyones (caja) | Arte | und | 16
Témperas (caja) | Arte | und | 16
Plastilina | Arte | und | 16
Pega blanca | Arte | und | 16
Pega en barra | Arte | und | 16
Tijera escolar | Útiles | und | 16
Regla 30 cm | Útiles | und | 16
Juego de geometría | Útiles | und | 16
Compás | Útiles | und | 16
Carpeta | Útiles | und | 16
Papel bond carta (resma) | Papel | und | 16
Hojas de examen | Papel | und | 16
Cartulina | Papel | und | 16
Papel lustrillo | Papel | und | 16
Foami | Papel | und | 16
Morral escolar | Útiles | und | 16
Libro de texto | Libros | und | E?
Diccionario | Libros | und | E?
Grapadora | Oficina | und | 16
Grapas (caja) | Oficina | und | 16
Clips (caja) | Oficina | und | 16
Sobre manila | Oficina | und | 16
Fotocopia | Servicios | und | 16
Impresión | Servicios | und | 16
"""


CAT['ropa'] = """
Franela de dama | Dama | und | 16
Franela de caballero | Caballero | und | 16
Franela de niño | Niños | und | 16
Camisa de caballero | Caballero | und | 16
Chemise | Caballero | und | 16
Blusa | Dama | und | 16
Top | Dama | und | 16
Body | Dama | und | 16
Vestido | Dama | und | 16
Falda | Dama | und | 16
Jean de dama | Dama | und | 16
Jean de caballero | Caballero | und | 16
Pantalón de vestir | Caballero | und | 16
Short | Caballero | und | 16
Licra deportiva | Deportivo | und | 16
Conjunto deportivo | Deportivo | und | 16
Mono deportivo | Deportivo | und | 16
Chaqueta | Abrigos | und | 16
Suéter | Abrigos | und | 16
Pijama | Ropa de dormir | und | 16
Ropa interior de dama | Ropa interior | und | 16
Ropa interior de caballero | Ropa interior | und | 16
Brasier | Ropa interior | und | 16
Faja | Ropa interior | und | 16
Medias (par) | Ropa interior | und | 16
Traje de baño | Playa | und | 16
Ropa de bebé | Niños | und | 16
Conjunto de niña | Niños | und | 16
Uniforme escolar | Niños | und | 16
Zapatos de dama | Calzado | und | 16
Zapatos de caballero | Calzado | und | 16
Zapatos deportivos | Calzado | und | 16
Sandalias | Calzado | und | 16
Cholas | Calzado | und | 16
Botas | Calzado | und | 16
Zapatos de niño | Calzado | und | 16
Cartera | Accesorios | und | 16
Bolso | Accesorios | und | 16
Billetera | Accesorios | und | 16
Correa | Accesorios | und | 16
Gorra | Accesorios | und | 16
Lentes de sol | Accesorios | und | 16
Reloj | Accesorios | und | 16
Zarcillos | Bisutería | und | 16
Collar | Bisutería | und | 16
Pulsera | Bisutería | und | 16
Anillo | Bisutería | und | 16
Accesorios para el cabello | Accesorios | und | 16
Bufanda | Accesorios | und | 16
"""

CAT['telefonia'] = """
Teléfono celular básico | Equipos | und | 16
Teléfono inteligente | Equipos | und | 16
Tableta | Equipos | und | 16
Forro para celular | Accesorios | und | 16
Vidrio templado | Accesorios | und | 16
Cargador de pared | Accesorios | und | 16
Cargador para carro | Accesorios | und | 16
Cable USB tipo C | Accesorios | und | 16
Cable micro USB | Accesorios | und | 16
Cable para iPhone | Accesorios | und | 16
Audífonos con cable | Audio | und | 16
Audífonos inalámbricos | Audio | und | 16
Corneta bluetooth | Audio | und | 16
Batería externa (power bank) | Accesorios | und | 16
Memoria micro SD 32 GB | Almacenamiento | und | 16
Memoria micro SD 64 GB | Almacenamiento | und | 16
Pendrive 32 GB | Almacenamiento | und | 16
Soporte para celular | Accesorios | und | 16
Reloj inteligente | Equipos | und | 16
Mouse | Computación | und | 16
Teclado | Computación | und | 16
Tarjeta SIM (línea) | Líneas y recargas | und | 16?
Recarga de saldo | Líneas y recargas | und | 16?
Cambio de pantalla | Servicio técnico | und | 16
Cambio de pin de carga | Servicio técnico | und | 16
Cambio de batería | Servicio técnico | und | 16
Desbloqueo y programación | Servicio técnico | und | 16
"""

CAT['quincalla'] = """
Vasos de vidrio | Hogar | und | 16
Platos | Hogar | und | 16
Tazas | Hogar | und | 16
Cubiertos (juego) | Hogar | und | 16
Ollas | Hogar | und | 16
Sartén | Hogar | und | 16
Envases plásticos | Hogar | und | 16
Tobos | Hogar | und | 16
Coletos | Limpieza | und | 16
Escobas | Limpieza | und | 16
Haraganes | Limpieza | und | 16
Pinzas para ropa | Hogar | und | 16
Ganchos de ropa | Hogar | und | 16
Toallas | Hogar | und | 16
Sábanas | Hogar | und | 16
Cortinas | Hogar | und | 16
Juguetes | Juguetería | und | 16
Pelotas | Juguetería | und | 16
Muñecas | Juguetería | und | 16
Globos (paquete) | Fiesta | und | 16
Velas de cumpleaños | Fiesta | und | 16
Papel de regalo | Fiesta | und | 16
Bolsas de regalo | Fiesta | und | 16
Pilas AA (par) | Electrónica | und | 16
Linterna | Electrónica | und | 16
Extensión eléctrica | Electrónica | und | 16
Bombillo LED | Electrónica | und | 16
Cuadernos | Útiles | und | 16?
Bolígrafos | Útiles | und | 16
Tijeras | Útiles | und | 16
Pega | Útiles | und | 16
Hilo de coser | Mercería | und | 16
Agujas | Mercería | und | 16
Cierres | Mercería | und | 16
Botones | Mercería | und | 16
Accesorios para el cabello | Accesorios | und | 16
Cosméticos | Accesorios | und | 16
Bisutería | Accesorios | und | 16
"""


CAT['comida_rapida'] = """
Perro caliente sencillo | Perros calientes | und | 16
Perro caliente especial | Perros calientes | und | 16
Perro caliente polaco | Perros calientes | und | 16
Hamburguesa sencilla | Hamburguesas | und | 16
Hamburguesa con queso | Hamburguesas | und | 16
Hamburguesa doble | Hamburguesas | und | 16
Hamburguesa de pollo | Hamburguesas | und | 16
Hamburguesa especial de la casa | Hamburguesas | und | 16
Pepito de carne | Pepitos | und | 16
Pepito de pollo | Pepitos | und | 16
Pepito mixto | Pepitos | und | 16
Arepa reina pepiada | Arepas | und | 16
Arepa dominó | Arepas | und | 16
Arepa pelúa | Arepas | und | 16
Arepa catira | Arepas | und | 16
Arepa de queso | Arepas | und | 16
Arepa de jamón y queso | Arepas | und | 16
Arepa con carne mechada | Arepas | und | 16
Empanada de carne | Empanadas | und | 16
Empanada de pollo | Empanadas | und | 16
Empanada de queso | Empanadas | und | 16
Empanada de cazón | Empanadas | und | 16
Cachapa con queso | Cachapas | und | 16
Cachapa con queso y cochino | Cachapas | und | 16
Patacón | Patacones | und | 16
Shawarma | Otros | und | 16
Salchipapa | Otros | und | 16
Tequeños (porción) | Acompañantes | und | 16
Papas fritas (porción) | Acompañantes | und | 16
Tostones (porción) | Acompañantes | und | 16
Pollo frito (pieza) | Pollo | und | 16
Alitas (porción) | Pollo | und | 16
Combo del día | Combos | und | 16
Refresco (vaso) | Bebidas | und | 16
Refresco lata | Bebidas | und | 16
Jugo natural | Bebidas | und | 16
Malta | Bebidas | und | 16
Agua mineral | Bebidas | und | 16
Merengada | Bebidas | und | 16
Café | Bebidas | und | 16
Envase para llevar | Empaques | und | 16
Servicio de delivery | Servicios | und | 16
"""

CAT['restaurante'] = """
Desayuno criollo | Desayunos | und | 16
Arepa con acompañantes | Desayunos | und | 16
Empanadas (ración) | Desayunos | und | 16
Huevos al gusto | Desayunos | und | 16
Pabellón criollo | Platos principales | und | 16
Pollo a la plancha | Platos principales | und | 16
Pollo guisado | Platos principales | und | 16
Carne asada | Platos principales | und | 16
Carne mechada | Platos principales | und | 16
Bistec encebollado | Platos principales | und | 16
Chuleta de cerdo | Platos principales | und | 16
Pescado frito | Platos principales | und | 16
Parrilla para dos | Parrillas | und | 16
Parrilla mixta | Parrillas | und | 16
Pasta a la boloñesa | Pastas | und | 16
Pasta carbonara | Pastas | und | 16
Sopa del día | Sopas | und | 16
Hervido de res | Sopas | und | 16
Hervido de gallina | Sopas | und | 16
Ensalada mixta | Ensaladas | und | 16
Ensalada César | Ensaladas | und | 16
Arroz (contorno) | Contornos | und | 16
Tajadas (contorno) | Contornos | und | 16
Yuca (contorno) | Contornos | und | 16
Papas fritas (contorno) | Contornos | und | 16
Menú ejecutivo | Menú del día | und | 16
Quesillo | Postres | und | 16
Torta (porción) | Postres | und | 16
Tres leches | Postres | und | 16
Jugo natural | Bebidas | und | 16
Refresco | Bebidas | und | 16
Agua mineral | Bebidas | und | 16
Café | Bebidas | und | 16
Cerveza | Bebidas | und | 16?
Servicio a domicilio | Servicios | und | 16
"""

CAT['panaderia_prod'] = """
Harina de trigo panadera (saco 45 kg) | Harinas | bulto | E?
Harina de trigo todo uso (saco) | Harinas | bulto | E?
Azúcar (saco 50 kg) | Endulzantes | bulto | 16?
Azúcar pulverizada | Endulzantes | kg | 16
Sal (saco) | Insumos | bulto | E
Levadura fresca | Insumos | kg | 16
Levadura seca | Insumos | und | 16
Mejorador de pan | Insumos | kg | 16
Polvo de hornear | Insumos | kg | 16
Manteca vegetal | Grasas | kg | 16?
Margarina para hojaldre | Grasas | kg | 16?
Mantequilla | Grasas | kg | E
Aceite vegetal (garrafa) | Grasas | und | E
Huevos (cartón de 30) | Insumos | und | E
Leche en polvo (saco) | Insumos | bulto | E
Esencia de vainilla | Insumos | und | 16
Cacao en polvo | Insumos | kg | 16
Chocolate de cobertura | Insumos | kg | 16
Crema pastelera (mezcla) | Insumos | kg | 16
Queso para relleno | Rellenos | kg | 16?
Jamón para relleno | Rellenos | kg | 16
Guayaba en pasta | Rellenos | kg | 16
Papelón | Endulzantes | und | 16?
Bolsas para pan | Empaques | und | 16
Cajas para torta | Empaques | und | 16
Bandejas de cartón | Empaques | und | 16
Gas (bombona industrial) | Servicios | und | E?
"""

CAT['belleza'] = """
Champú profesional | Cabello | und | 16
Acondicionador profesional | Cabello | und | 16
Tratamiento capilar | Cabello | und | 16
Keratina | Cabello | und | 16
Tinte | Coloración | und | 16
Oxidante | Coloración | und | 16
Decolorante | Coloración | und | 16
Gel para cabello | Peinado | und | 16
Cera para cabello | Peinado | und | 16
Laca | Peinado | und | 16
Esmalte de uñas | Uñas | und | 16
Gel para uñas | Uñas | und | 16
Acrílico para uñas | Uñas | und | 16
Quitaesmalte | Uñas | und | 16
Limas | Uñas | und | 16
Cuchillas de afeitar | Barbería | und | 16
Espuma de afeitar | Barbería | und | 16
After shave | Barbería | und | 16
Talco | Barbería | und | 16
Cera depilatoria | Depilación | und | 16
Corte de dama | Servicios | und | 16
Corte de caballero | Servicios | und | 16
Corte de niño | Servicios | und | 16
Barba | Servicios | und | 16
Secado (blower) | Servicios | und | 16
Planchado | Servicios | und | 16
Tinte (servicio) | Servicios | und | 16
Mechas | Servicios | und | 16
Alisado con keratina (servicio) | Servicios | und | 16
Manicure | Servicios | und | 16
Pedicure | Servicios | und | 16
Uñas acrílicas (servicio) | Servicios | und | 16
Depilación de cejas | Servicios | und | 16
Maquillaje | Servicios | und | 16
"""

CAT['taller'] = """
Cambio de aceite (mano de obra) | Servicios | und | 16
Afinación | Servicios | und | 16
Diagnóstico con escáner | Servicios | und | 16
Cambio de pastillas de freno (mano de obra) | Servicios | und | 16
Rectificación de discos | Servicios | und | 16
Alineación | Servicios | und | 16
Balanceo | Servicios | und | 16
Cambio de correa de tiempo (mano de obra) | Servicios | und | 16
Reparación de motor | Servicios | und | 16
Reparación de caja | Servicios | und | 16
Trabajo eléctrico | Servicios | und | 16
Latonería | Servicios | und | 16
Pintura de pieza | Servicios | und | 16
Lavado de motor | Servicios | und | 16
Aceite de motor 15W40 (litro) | Repuestos | und | 16
Aceite de motor 20W50 (litro) | Repuestos | und | 16
Filtro de aceite | Repuestos | und | 16
Filtro de aire | Repuestos | und | 16
Bujías (juego) | Repuestos | und | 16
Pastillas de freno | Repuestos | und | 16
Líquido de frenos | Repuestos | und | 16
Refrigerante (galón) | Repuestos | und | 16
Limpiador de carburador | Repuestos | und | 16
Desengrasante | Repuestos | und | 16
"""

CAT['cauchera'] = """
Caucho rin 13 | Cauchos nuevos | und | 16
Caucho rin 14 | Cauchos nuevos | und | 16
Caucho rin 15 | Cauchos nuevos | und | 16
Caucho rin 16 | Cauchos nuevos | und | 16
Caucho rin 17 | Cauchos nuevos | und | 16
Caucho de camioneta | Cauchos nuevos | und | 16
Caucho de moto | Cauchos nuevos | und | 16
Caucho usado | Cauchos usados | und | 16
Caucho reencauchado | Cauchos usados | und | 16
Tripa | Accesorios | und | 16
Válvula | Accesorios | und | 16
Parche | Accesorios | und | 16
Tapón para caucho | Accesorios | und | 16
Pesas de balanceo | Accesorios | und | 16
Rin | Rines | und | 16
Montaje de caucho | Servicios | und | 16
Desmontaje de caucho | Servicios | und | 16
Reparación de pinchazo | Servicios | und | 16
Balanceo | Servicios | und | 16
Alineación | Servicios | und | 16
Rotación de cauchos | Servicios | und | 16
Inflado con nitrógeno | Servicios | und | 16
"""

CAT['construccion'] = """
Cemento gris (saco 42,5 kg) | Cemento y agregados | bulto | 16
Cemento blanco (saco) | Cemento y agregados | bulto | 16
Arena lavada (m³) | Cemento y agregados | und | 16
Arena de río (m³) | Cemento y agregados | und | 16
Piedra picada (m³) | Cemento y agregados | und | 16
Granzón (m³) | Cemento y agregados | und | 16
Cal (saco) | Cemento y agregados | bulto | 16
Concreto premezclado (m³) | Cemento y agregados | und | 16
Bloque de arcilla 15 | Bloques | und | 16
Bloque de arcilla 10 | Bloques | und | 16
Bloque de cemento 15 | Bloques | und | 16
Bloque de cemento 20 | Bloques | und | 16
Ladrillo | Bloques | und | 16
Cabilla 3/8 | Acero | und | 16
Cabilla 1/2 | Acero | und | 16
Cabilla 5/8 | Acero | und | 16
Malla truckson | Acero | und | 16
Alambre dulce | Acero | kg | 16
Perfil tubular | Acero | und | 16
Lámina de zinc | Techos | und | 16
Lámina acerolit | Techos | und | 16
Teja | Techos | und | 16
Correa para techo | Techos | und | 16
Manto asfáltico | Impermeabilización | und | 16
Impermeabilizante | Impermeabilización | und | 16
Cerámica para piso (m²) | Acabados | und | 16
Porcelanato (m²) | Acabados | und | 16
Pego para cerámica (saco) | Acabados | bulto | 16
Porcelana para juntas | Acabados | und | 16
Friso listo (saco) | Acabados | bulto | 16
Lámina de drywall | Acabados | und | 16
Pasta para drywall | Acabados | und | 16
Tubo PVC 4 pulgadas | Plomería | und | 16
Tubo PVC 1/2 | Plomería | und | 16
Poceta | Sanitarios | und | 16
Lavamanos | Sanitarios | und | 16
Fregadero | Sanitarios | und | 16
Tanque de agua | Sanitarios | und | 16
Puerta de madera | Puertas y ventanas | und | 16
Puerta de hierro | Puertas y ventanas | und | 16
Ventana panorámica | Puertas y ventanas | und | 16
Flete | Servicios | und | 16
"""

CAT['electricos'] = """
Cable número 14 | Cables | m | 16
Cable número 12 | Cables | m | 16
Cable número 10 | Cables | m | 16
Cable número 8 | Cables | m | 16
Cable dúplex | Cables | m | 16
Cable de teléfono | Cables | m | 16
Cable coaxial | Cables | m | 16
Cable UTP (red) | Cables | m | 16
Tubo conduit 1/2 | Canalización | und | 16
Tubo conduit 3/4 | Canalización | und | 16
Canaleta plástica | Canalización | und | 16
Caja de paso | Canalización | und | 16
Tomacorriente doble | Accesorios | und | 16
Tomacorriente 220 V | Accesorios | und | 16
Interruptor sencillo | Accesorios | und | 16
Interruptor doble | Accesorios | und | 16
Interruptor triple | Accesorios | und | 16
Tapa ciega | Accesorios | und | 16
Socate | Accesorios | und | 16
Enchufe macho | Accesorios | und | 16
Regleta | Accesorios | und | 16
Breaker 15 A | Protección | und | 16
Breaker 20 A | Protección | und | 16
Breaker 30 A | Protección | und | 16
Breaker 40 A | Protección | und | 16
Tablero eléctrico | Protección | und | 16
Protector de voltaje | Protección | und | 16
Bombillo LED 9 W | Iluminación | und | 16
Bombillo LED 12 W | Iluminación | und | 16
Bombillo LED 20 W | Iluminación | und | 16
Tubo LED | Iluminación | und | 16
Panel LED | Iluminación | und | 16
Reflector LED | Iluminación | und | 16
Lámpara de techo | Iluminación | und | 16
Cinta LED | Iluminación | m | 16
Cinta aislante | Insumos | und | 16
Conectores de cable | Insumos | und | 16
Teipe | Insumos | und | 16
Multímetro | Herramientas | und | 16
Pinza amperimétrica | Herramientas | und | 16
"""

CAT['electro'] = """
Nevera | Línea blanca | und | 16
Cocina a gas | Línea blanca | und | 16
Cocina eléctrica | Línea blanca | und | 16
Lavadora | Línea blanca | und | 16
Secadora | Línea blanca | und | 16
Freezer | Línea blanca | und | 16
Aire acondicionado | Climatización | und | 16
Ventilador | Climatización | und | 16
Televisor 32 pulgadas | Audio y video | und | 16
Televisor 43 pulgadas | Audio y video | und | 16
Televisor 55 pulgadas | Audio y video | und | 16
Equipo de sonido | Audio y video | und | 16
Corneta | Audio y video | und | 16
Microondas | Pequeños electrodomésticos | und | 16
Licuadora | Pequeños electrodomésticos | und | 16
Cafetera | Pequeños electrodomésticos | und | 16
Tostiarepa | Pequeños electrodomésticos | und | 16
Freidora de aire | Pequeños electrodomésticos | und | 16
Plancha | Pequeños electrodomésticos | und | 16
Batidora | Pequeños electrodomésticos | und | 16
Arrocera | Pequeños electrodomésticos | und | 16
Olla de presión | Pequeños electrodomésticos | und | 16
Secador de cabello | Cuidado personal | und | 16
Plancha para cabello | Cuidado personal | und | 16
Regulador de voltaje | Protección | und | 16
Protector de nevera | Protección | und | 16
Inversor | Energía | und | 16
Planta eléctrica | Energía | und | 16
Batería para inversor | Energía | und | 16
"""

CAT['jugueteria'] = """
Muñeca | Muñecas | und | 16
Peluche | Peluches | und | 16
Carro a control remoto | Vehículos | und | 16
Carrito de juguete | Vehículos | und | 16
Pelota | Deportes | und | 16
Bicicleta | Deportes | und | 16
Patineta | Deportes | und | 16
Patines | Deportes | und | 16
Juego de mesa | Juegos | und | 16
Rompecabezas | Juegos | und | 16
Bloques para armar | Juegos | und | 16
Figura de acción | Figuras | und | 16
Juguete didáctico | Bebés | und | 16
Sonajero | Bebés | und | 16
Pistola de agua | Temporada | und | 16
Piñata | Fiesta | und | 16
Globos (paquete) | Fiesta | und | 16
Cotillón | Fiesta | und | 16
Papel de regalo | Regalos | und | 16
Bolsa de regalo | Regalos | und | 16
Tarjeta de felicitación | Regalos | und | 16
Taza decorada | Regalos | und | 16
Portarretrato | Regalos | und | 16
"""

CAT['oficina'] = """
Papel bond carta (resma) | Papel | und | 16
Papel bond oficio (resma) | Papel | und | 16
Papel para impresora térmica (rollo) | Papel | und | 16
Sobre manila carta | Archivo | und | 16
Carpeta marrón | Archivo | und | 16
Carpeta de fuelle | Archivo | und | 16
Archivador | Archivo | und | 16
Separadores | Archivo | und | 16
Bolígrafo azul (caja) | Escritura | und | 16
Bolígrafo negro (caja) | Escritura | und | 16
Marcador permanente | Escritura | und | 16
Resaltador | Escritura | und | 16
Corrector | Escritura | und | 16
Grapadora | Escritorio | und | 16
Grapas (caja) | Escritorio | und | 16
Saca grapas | Escritorio | und | 16
Perforadora | Escritorio | und | 16
Clips (caja) | Escritorio | und | 16
Gancho mariposa (caja) | Escritorio | und | 16
Cinta adhesiva | Escritorio | und | 16
Notas adhesivas | Escritorio | und | 16
Tijera | Escritorio | und | 16
Calculadora | Equipos | und | 16
Tóner | Impresión | und | 16
Cartucho de tinta negro | Impresión | und | 16
Cartucho de tinta a color | Impresión | und | 16
Tinta para recargar | Impresión | und | 16
Sello de goma | Sellos | und | 16
Tinta para sello | Sellos | und | 16
Libro de actas | Libros contables | und | 16?
Libro diario | Libros contables | und | 16?
Talonario de recibos | Formularios | und | 16
"""

CAT['veterinaria'] = """
Alimento para perro adulto (saco) | Alimentos | bulto | 16?
Alimento para cachorro (saco) | Alimentos | bulto | 16?
Alimento para gato (saco) | Alimentos | bulto | 16?
Alimento húmedo (lata) | Alimentos | und | 16?
Desparasitante interno | Medicinas | und | E?
Antipulgas | Medicinas | und | E?
Vacuna antirrábica | Vacunas | und | E?
Vacuna séxtuple | Vacunas | und | E?
Antibiótico veterinario | Medicinas | und | E?
Vitaminas | Medicinas | und | E?
Champú para mascotas | Higiene | und | 16
Collar | Accesorios | und | 16
Correa | Accesorios | und | 16
Comedero | Accesorios | und | 16
Cama para mascota | Accesorios | und | 16
Arena para gatos | Higiene | und | 16
Juguete para mascota | Accesorios | und | 16
Consulta veterinaria | Servicios | und | E?
Vacunación (servicio) | Servicios | und | E?
Baño y peluquería | Servicios | und | 16
Desparasitación (servicio) | Servicios | und | E?
Esterilización | Servicios | und | E?
"""

CAT['optica'] = """
Montura de metal | Monturas | und | 16
Montura de pasta | Monturas | und | 16
Montura infantil | Monturas | und | 16
Cristales monofocales (par) | Cristales | und | E?
Cristales bifocales (par) | Cristales | und | E?
Cristales progresivos (par) | Cristales | und | E?
Antirreflejo | Tratamientos | und | E?
Fotocromático | Tratamientos | und | E?
Lentes de contacto | Contacto | und | E?
Solución para lentes de contacto | Contacto | und | 16?
Lentes de sol | Sol | und | 16
Estuche | Accesorios | und | 16
Paño de limpieza | Accesorios | und | 16
Cordón para lentes | Accesorios | und | 16
Examen de la vista | Servicios | und | E?
Reparación de montura | Servicios | und | 16
"""


# ── SERVICIOS ────────────────────────────────────────────────────────────────
# Los servicios médico-asistenciales y odontológicos están exentos (Ley del IVA,
# art. 19). Los servicios profesionales (contables, gimnasio) van al 16%.

CAT['gimnasio'] = """
Inscripción | Membresías | und | 16
Mensualidad | Membresías | und | 16
Plan trimestral | Membresías | und | 16
Plan semestral | Membresías | und | 16
Plan anual | Membresías | und | 16
Pase diario | Membresías | und | 16
Pase semanal | Membresías | und | 16
Mensualidad estudiante | Membresías | und | 16
Mensualidad pareja | Membresías | und | 16
Clase de bailoterapia | Clases | und | 16
Clase de spinning | Clases | und | 16
Clase de funcional | Clases | und | 16
Clase de crossfit | Clases | und | 16
Clase de yoga | Clases | und | 16
Clase de pilates | Clases | und | 16
Clase de boxeo | Clases | und | 16
Clase de artes marciales | Clases | und | 16
Clase de natación | Clases | und | 16
Entrenamiento personalizado (sesión) | Entrenador | und | 16
Entrenamiento personalizado (mes) | Entrenador | und | 16
Plan de entrenamiento | Entrenador | und | 16
Evaluación física | Entrenador | und | 16
Plan nutricional | Entrenador | und | 16?
Alquiler de casillero | Otros | und | 16
Agua mineral | Tienda | und | 16
Bebida isotónica | Tienda | und | 16
Proteína en polvo | Tienda | und | 16
Creatina | Tienda | und | 16
Barra de proteína | Tienda | und | 16
Guantes de entrenamiento | Tienda | und | 16
Cinturón de pesas | Tienda | und | 16
Toalla | Tienda | und | 16
Franela del gimnasio | Tienda | und | 16
"""

CAT['contable'] = """
Honorarios de contabilidad mensual | Contabilidad | und | 16
Honorarios de contabilidad (persona natural) | Contabilidad | und | 16
Estados financieros | Contabilidad | und | 16
Estados financieros auditados | Contabilidad | und | 16
Certificación de ingresos | Contabilidad | und | 16
Balance personal | Contabilidad | und | 16
Auditoría | Contabilidad | und | 16
Revisión limitada | Contabilidad | und | 16
Libros contables (sellado y apertura) | Contabilidad | und | 16
Declaración de IVA | Tributos | und | 16
Declaración de IVA (sin movimiento) | Tributos | und | 16
Declaración de retenciones de IVA | Tributos | und | 16
Declaración de retenciones de ISLR | Tributos | und | 16
Declaración de ISLR anual (persona jurídica) | Tributos | und | 16
Declaración de ISLR anual (persona natural) | Tributos | und | 16
Declaración estimada de ISLR | Tributos | und | 16
Declaración de IGTF | Tributos | und | 16
Declaración de impuestos municipales | Tributos | und | 16
Declaración de grandes patrimonios | Tributos | und | 16
Libros de compras y ventas | Tributos | und | 16
Inscripción de RIF | Trámites SENIAT | und | 16
Actualización de RIF | Trámites SENIAT | und | 16
Solicitud de solvencia | Trámites SENIAT | und | 16
Atención de fiscalización | Trámites SENIAT | und | 16
Recurso o descargo ante el SENIAT | Trámites SENIAT | und | 16
Nómina mensual | Nómina | und | 16
Nómina quincenal | Nómina | und | 16
Cálculo de prestaciones sociales | Nómina | und | 16
Liquidación de trabajador | Nómina | und | 16
Cálculo de utilidades | Nómina | und | 16
Cálculo de vacaciones | Nómina | und | 16
Constancia de trabajo | Nómina | und | 16
Inscripción en el IVSS | Parafiscales | und | 16
Inscripción en el INCES | Parafiscales | und | 16
Inscripción en el BANAVIH (FAOV) | Parafiscales | und | 16
Declaración y pago del IVSS | Parafiscales | und | 16
Declaración y pago del INCES | Parafiscales | und | 16
Declaración y pago del FAOV | Parafiscales | und | 16
Solvencia laboral | Parafiscales | und | 16
Registro de empresa (acompañamiento) | Mercantil | und | 16
Acta de asamblea | Mercantil | und | 16
Licencia de actividades económicas | Municipal | und | 16
Asesoría contable (hora) | Asesoría | und | 16
Asesoría tributaria (hora) | Asesoría | und | 16
Planificación fiscal | Asesoría | und | 16
"""

# El consultorio se separa por especialidad: cada una es un ramo con su lista.
CAT['consultorio'] = """
Consulta de medicina general | Consultas | und | E
Consulta de control | Consultas | und | E
Consulta a domicilio | Consultas | und | E
Informe médico | Documentos | und | E
Certificado de salud | Documentos | und | E
Certificado médico | Documentos | und | E
Récipe | Documentos | und | E
Curas | Procedimientos | und | E
Retiro de puntos | Procedimientos | und | E
Sutura | Procedimientos | und | E
Inyección | Procedimientos | und | E
Nebulización | Procedimientos | und | E
Toma de tensión | Procedimientos | und | E
Glicemia capilar | Procedimientos | und | E
Electrocardiograma | Estudios | und | E
"""

CAT['odontologia'] = """
Consulta odontológica | Consultas | und | E
Limpieza dental | Prevención | und | E
Aplicación de flúor | Prevención | und | E
Sellantes | Prevención | und | E
Resina | Operatoria | und | E
Amalgama | Operatoria | und | E
Extracción simple | Cirugía | und | E
Extracción de cordal | Cirugía | und | E
Tratamiento de conducto (endodoncia) | Endodoncia | und | E
Corona | Prótesis | und | E
Puente fijo | Prótesis | und | E
Prótesis removible | Prótesis | und | E
Dentadura total | Prótesis | und | E
Implante dental | Implantes | und | E
Blanqueamiento dental | Estética | und | E?
Carillas | Estética | und | E?
Ortodoncia (instalación de brackets) | Ortodoncia | und | E
Control de ortodoncia (mensualidad) | Ortodoncia | und | E
Retenedor | Ortodoncia | und | E
Radiografía periapical | Estudios | und | E
Radiografía panorámica | Estudios | und | E
Tartrectomía | Periodoncia | und | E
Curetaje | Periodoncia | und | E
"""

CAT['pediatria'] = """
Consulta pediátrica | Consultas | und | E
Control de niño sano | Consultas | und | E
Consulta de recién nacido | Consultas | und | E
Consulta a domicilio | Consultas | und | E
Vacunación | Procedimientos | und | E
Nebulización | Procedimientos | und | E
Lavado de oídos | Procedimientos | und | E
Curas | Procedimientos | und | E
Informe médico | Documentos | und | E
Certificado de salud | Documentos | und | E
Certificado escolar | Documentos | und | E
"""

CAT['ginecologia'] = """
Consulta ginecológica | Consultas | und | E
Consulta de control prenatal | Consultas | und | E
Citología | Estudios | und | E
Colposcopia | Estudios | und | E
Ecografía transvaginal | Ecografías | und | E
Ecografía obstétrica | Ecografías | und | E
Ecografía 4D | Ecografías | und | E
Ecografía mamaria | Ecografías | und | E
Perfil biofísico | Ecografías | und | E
Inserción de DIU | Procedimientos | und | E
Retiro de DIU | Procedimientos | und | E
Implante anticonceptivo | Procedimientos | und | E
Biopsia | Procedimientos | und | E
Parto | Cirugía | und | E
Cesárea | Cirugía | und | E
Informe médico | Documentos | und | E
"""

CAT['traumatologia'] = """
Consulta traumatológica | Consultas | und | E
Consulta de control | Consultas | und | E
Infiltración | Procedimientos | und | E
Colocación de yeso | Procedimientos | und | E
Retiro de yeso | Procedimientos | und | E
Inmovilización con férula | Procedimientos | und | E
Reducción de fractura | Procedimientos | und | E
Artroscopia | Cirugía | und | E
Cirugía de fractura (osteosíntesis) | Cirugía | und | E
Informe médico | Documentos | und | E
Férula | Insumos | und | E?
Muletas | Insumos | und | E?
Cuello ortopédico | Insumos | und | E?
"""

CAT['cardiologia'] = """
Consulta cardiológica | Consultas | und | E
Evaluación cardiovascular preoperatoria | Consultas | und | E
Electrocardiograma | Estudios | und | E
Ecocardiograma | Estudios | und | E
Prueba de esfuerzo | Estudios | und | E
Holter de 24 horas | Estudios | und | E
Monitoreo ambulatorio de tensión (MAPA) | Estudios | und | E
Eco doppler | Estudios | und | E
Informe médico | Documentos | und | E
"""

CAT['dermatologia'] = """
Consulta dermatológica | Consultas | und | E
Consulta de control | Consultas | und | E
Crioterapia | Procedimientos | und | E
Electrocauterización | Procedimientos | und | E
Biopsia de piel | Procedimientos | und | E
Retiro de lunar | Procedimientos | und | E
Dermatoscopia | Estudios | und | E
Peeling químico | Estética | und | E?
Limpieza facial | Estética | und | 16?
Toxina botulínica | Estética | und | E?
Relleno con ácido hialurónico | Estética | und | E?
Informe médico | Documentos | und | E
"""

CAT['oftalmologia'] = """
Consulta oftalmológica | Consultas | und | E
Examen de la vista (refracción) | Consultas | und | E
Fondo de ojo | Estudios | und | E
Tonometría (presión ocular) | Estudios | und | E
Campo visual | Estudios | und | E
Topografía corneal | Estudios | und | E
Cirugía de catarata | Cirugía | und | E
Cirugía de pterigión | Cirugía | und | E
Cirugía refractiva (láser) | Cirugía | und | E
Informe médico | Documentos | und | E
"""

CAT['otorrino'] = """
Consulta otorrinolaringológica | Consultas | und | E
Lavado de oídos | Procedimientos | und | E
Nasofibrolaringoscopia | Estudios | und | E
Audiometría | Estudios | und | E
Impedanciometría | Estudios | und | E
Cauterización nasal | Procedimientos | und | E
Amigdalectomía | Cirugía | und | E
Septoplastia | Cirugía | und | E
Informe médico | Documentos | und | E
"""

CAT['medicina_interna'] = """
Consulta de medicina interna | Consultas | und | E
Consulta de control | Consultas | und | E
Evaluación preoperatoria | Consultas | und | E
Control de diabetes | Consultas | und | E
Control de hipertensión | Consultas | und | E
Electrocardiograma | Estudios | und | E
Ecografía abdominal | Estudios | und | E
Informe médico | Documentos | und | E
"""

CAT['psicologia'] = """
Consulta psicológica | Consultas | und | E?
Terapia individual (sesión) | Terapias | und | E?
Terapia de pareja (sesión) | Terapias | und | E?
Terapia familiar (sesión) | Terapias | und | E?
Terapia infantil (sesión) | Terapias | und | E?
Evaluación psicológica | Evaluaciones | und | E?
Evaluación psicotécnica | Evaluaciones | und | E?
Informe psicológico | Documentos | und | E?
Taller grupal | Talleres | und | 16?
"""

CAT['nutricion'] = """
Consulta nutricional | Consultas | und | E?
Consulta de control | Consultas | und | E?
Plan de alimentación | Planes | und | E?
Evaluación de composición corporal | Evaluaciones | und | E?
Plan nutricional deportivo | Planes | und | E?
Paquete mensual de controles | Planes | und | E?
"""

CAT['fisioterapia'] = """
Evaluación fisioterapéutica | Consultas | und | E
Sesión de fisioterapia | Terapias | und | E
Paquete de 10 sesiones | Terapias | und | E
Rehabilitación postoperatoria (sesión) | Terapias | und | E
Terapia con electroestimulación | Terapias | und | E
Terapia con ultrasonido | Terapias | und | E
Masaje terapéutico | Terapias | und | E?
Drenaje linfático | Terapias | und | E?
Terapia a domicilio | Terapias | und | E
Vendaje neuromuscular | Procedimientos | und | E
"""

CAT['laboratorio'] = """
Hematología completa | Hematología | und | E
Glicemia | Química sanguínea | und | E
Perfil lipídico | Química sanguínea | und | E
Urea y creatinina | Química sanguínea | und | E
Ácido úrico | Química sanguínea | und | E
Perfil hepático | Química sanguínea | und | E
Hemoglobina glicosilada | Química sanguínea | und | E
Perfil tiroideo | Hormonas | und | E
Prueba de embarazo en sangre | Hormonas | und | E
PSA | Hormonas | und | E
Examen de orina | Uroanálisis | und | E
Examen de heces | Coprología | und | E
Urocultivo | Microbiología | und | E
VDRL | Serología | und | E
VIH | Serología | und | E
Grupo sanguíneo | Hematología | und | E
Perfil prenatal | Perfiles | und | E
Perfil preoperatorio | Perfiles | und | E
Toma de muestra a domicilio | Servicios | und | E
"""

# La veterinaria ya trae productos; se le suman sus servicios
CAT['veterinaria'] = CAT['veterinaria'] + """
Consulta de control | Servicios | und | 16?
Consulta de emergencia | Servicios | und | 16?
Consulta a domicilio | Servicios | und | 16?
Hematología veterinaria | Servicios | und | 16?
Ecografía veterinaria | Servicios | und | 16?
Radiografía veterinaria | Servicios | und | 16?
Limpieza dental veterinaria | Servicios | und | 16?
Cirugía veterinaria | Servicios | und | 16?
Hospitalización (día) | Servicios | und | 16?
Eutanasia | Servicios | und | 16?
Certificado de salud para viaje | Servicios | und | 16?
Corte de uñas | Servicios | und | 16
Hospedaje de mascotas (día) | Servicios | und | 16
"""
# Los servicios veterinarios no son médico-asistenciales humanos: se marcan para revisar
CAT['veterinaria'] = CAT['veterinaria'].replace('| Servicios | und | E?', '| Servicios | und | 16?')


def filas(texto):
    out = []
    for n, linea in enumerate(l for l in texto.strip().splitlines() if l.strip()):
        partes = [p.strip() for p in linea.split('|')]
        assert len(partes) == 4, linea
        nombre, cat, uni, alic = partes
        assert uni in ('und', 'kg', 'g', 'L', 'ml', 'm', 'caja', 'bulto', 'doc'), linea
        assert alic in ('E', '16', 'E?', '16?'), linea
        out.append({
            'nombre': nombre, 'categoria': cat, 'unidad': uni,
            'por_peso': uni == 'kg',
            'alicuota': 'Exento' if alic.startswith('E') else '16%',
            'revisar': alic.endswith('?'),
            'orden': (n + 1) * 10,
        })
    nombres = [f['nombre'].lower() for f in out]
    assert len(nombres) == len(set(nombres)), 'nombre repetido en un ramo'
    return out


def q(s):
    return "'" + s.replace("'", "''") + "'"


if __name__ == '__main__':
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    total = 0
    valores = []
    for ramo, texto in CAT.items():
        fs = filas(texto)
        total += len(fs)
        for f in fs:
            valores.append('  (%s, %s, %s, %s, %s, %s, %s, %d)' % (
                q(ramo), q(f['nombre']), q(f['categoria']), q(f['unidad']),
                'true' if f['por_peso'] else 'false', q(f['alicuota']),
                'true' if f['revisar'] else 'false', f['orden']))
        print('%-16s %4d productos' % (ramo, len(fs)))
    plantilla = io.open(os.path.join(raiz, 'herramientas', 'catalogo_ramos.sql.tpl'), encoding='utf-8').read()
    ramos = ', '.join('(%s)' % q(r) for r in CAT)
    sql = (plantilla.replace('{{VALORES}}', ',\n'.join(valores))
           .replace('{{TOTAL}}', str(total)).replace('{{RAMOS}}', ramos))
    io.open(os.path.join(raiz, 'sql', 'catalogo_ramos.sql'), 'w', encoding='utf-8', newline='\n').write(sql)
    print('TOTAL', total, '→ sql/catalogo_ramos.sql')
