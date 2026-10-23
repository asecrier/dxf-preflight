# Distribuție (plan + texte gata de folosit)

Reguli: nu postez eu în numele tău pe conturi pe care nu le-ai aprobat; nu spam; citește regulile fiecărei comunități (multe interzic auto-promovarea sau cer să te declari autor); nu recenzii false; fiecare răspuns trebuie să ajute singur, linkul e secundar și cu declarația „am făcut acest instrument".

## Canale (în ordinea efortului)
1. Răspunsuri în fire existente pe teme: scară DXF greșită, forme deschise, linii duplicate (forumul LightBurn, r/lasercutting, forumuri CNC/plasmă). Se caută fire NOI cu întrebări neclare, nu fire vechi.
2. Listări: AlternativeTo (alternativă la instrumente de reparare/ofertare DXF), Product Hunt (necesită cont personal; lansare cu text onest).
3. Google Search Console: adaugă https://asecrier.github.io/dxf-preflight/ și trimite sitemap.xml (necesită contul tău Google; verificare prin fișier în repo — spune-mi și o fac).
4. Descrieri pe Gumroad Discover: apare doar după prima vânzare + verificare (criterii Gumroad).

## Text-șablon pentru răspuns (adaptează la întrebare; nu copia identic în mai multe locuri)
> Dacă fișierul ajunge de 25,4 ori prea mare/mic, e aproape sigur o problemă de unități: DXF-ul nu spune mereu în ce unitate e desenat. Deschide fișierul într-un editor de text și caută `$INSUNITS` (4 = mm, 1 = inch). În LightBurn poți seta unitatea la import (Edit → Settings → File Settings) și dezactiva auto-detect. Am scris pașii aici: https://asecrier.github.io/dxf-preflight/dxf-wrong-scale.html — am făcut și un instrument gratuit în browser care arată dimensiunea în mm și exportă DXF corectat (eu sunt autorul).

Variante echivalente pentru „open shapes" (dxf-open-contours.html) și „double cut" (dxf-duplicate-lines.html).

## Măsurare
Fără analytics deocamdată (site-ul declară că nu folosește). Singurele semnale reale acum: vânzări Gumroad, statistici GitHub Pages indisponibile; după activarea unui analytics fără cookie trebuie actualizată pagina de confidențialitate.
