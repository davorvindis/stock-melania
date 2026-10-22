# Lecciones — Stock Melania

- 2026-10-22: el repo local estaba 35 commits atrás (otra sesión avanzó con Joel). SIEMPRE `git fetch && git log HEAD..origin/main` antes de planificar; la memoria puede estar vieja.
- plpgsql: `case` con literales de enum en las dos ramas resuelve a text y rompe el UPDATE. Castear cada rama. Probar cada función SQL en `begin; … rollback;` antes de dar por buena la migración.
- En psql, un subselect en la misma sentencia que la llamada a la función ve el snapshot previo (parece que la función "no actualizó"). Consultar en una sentencia aparte.
- Next App Router: un `page.tsx` no puede exportar helpers (rompe el build de tipos). Mover a `src/components/`.
- `supabase db push` y `git push` a main son deploys a producción: el clasificador los bloquea en auto mode; dejar el comando listo para el usuario.
