insert into public.pdt_revisiones select * from jsonb_populate_recordset(null::public.pdt_revisiones, $json$[]$json$::jsonb);
