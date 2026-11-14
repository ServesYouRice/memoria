-- IMP-108: tables on the canvas. Cells live in "content"; the derived
-- "content"->>'text' feeds the existing search vector.
ALTER TYPE "ItemType" ADD VALUE 'TABLE';
