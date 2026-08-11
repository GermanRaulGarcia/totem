# Logotipos por sede

Un fichero por sede, con el **id** de la sede como nombre. El id es el mismo que
va en `config/sedes` y en `?sede=` de la URL del kiosco.

Se prueban en este orden, y se usa el primero que exista:

```
lorca.svg      ← preferido
lorca.png      ← vale igual
generica.svg   ← respaldo, un edificio
```

Así que **no hace falta vectorizar nada**: si el logotipo solo existe en PNG,
déjalo en PNG. Y si una sede todavía no tiene el suyo, sale el edificio genérico
en vez de un hueco.

Esto es lo que mantiene la promesa del diseño §9.2: publicas `config/sedes` y la
sede nueva aparece **el mismo día** con un icono digno, sin esperar a que nadie
dibuje nada. Cuando llegue el logotipo, se deja caer aquí y ya está — cero código.

## Cómo deben ser

- **SVG** si se puede, para que escale en un panel 4K sin pixelarse. Si es PNG,
  que tenga fondo transparente y al menos 256 px de lado.
- **Claro**: el fondo del tótem es negro `#171717`. Un logotipo oscuro no se ve.
  Si el original es oscuro, exporta una versión en blanco — aquí no se aplica
  ningún filtro que lo invierta.
- **Cuadrado**, o casi. Se dibuja dentro de una caja cuadrada.
- Sin texto pequeño: se ve a unos 40-60 px.

## Los tres que hay ahora NO son oficiales

`lorca.svg`, `canarias.svg` y `murcia.svg` están dibujados a mano y son
interpretaciones —la torre del castillo, una palmera canaria, la torre de la
catedral—, no la heráldica de cada ciudad ni una identidad de Victoria Crea.
Sustitúyelos en cuanto haya material real.
