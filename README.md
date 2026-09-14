# Demeter

Aplicación web para administrar estudios boutique (pole, yoga, pilates y disciplinas afines).

## Ambientes oficiales

- GitHub: `mikevazquez/Demeter`
- Supabase: proyecto nuevo **Studio Flow**
- Vercel: ambiente nuevo asociado exclusivamente a este repositorio

> No reutilizar IDs, variables, proyectos ni deployments de ambientes anteriores.

## Stack base

- Next.js 16 / App Router
- React 19
- TypeScript
- Supabase (Auth + Postgres + RLS)
- Vercel

## Configuración local

1. Instala dependencias con `npm install`.
2. Copia `.env.example` a `.env.local`.
3. Usa únicamente la URL y la publishable key del proyecto **Studio Flow**.
4. Ejecuta `npm run dev`.

## Base de datos

Las migraciones viven en `supabase/migrations/` y deben aplicarse únicamente al proyecto oficial **Studio Flow**.

La primera migración crea la base multi-estudio: perfiles, estudios, membresías/roles, disciplinas, clases, sesiones, paquetes de clases, paquetes de alumnas y reservaciones. Todas las tablas públicas nacen con RLS habilitado.
