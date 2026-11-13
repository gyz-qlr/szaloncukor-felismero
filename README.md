# Szaloncukor-felismerő

Családi segédlet: melyik Stühmer szaloncukor van a kezünkben – a sztaniol színe alapján, AI nélkül.

**Használat:** nyisd meg a linket Safariban → Megosztás → *Főképernyőhöz adás*. Utána:

1. Fotózd le a szaloncukrot közelről (szórt fény, vaku nélkül).
2. Koppints a **fehér papírvégre** – ebből igazítja a színeket a fényviszonyokhoz.
3. Koppints a sztaniol **fő színére**, majd ha van, a más színű **sávra/címkére** (vagy: *Nincs más színe*).
4. A 3 legvalószínűbb ízt mutatja a webshop-fotójával – a végső döntés a tiéd.

A ⚙ Beállításokban bepipálható, mit rendeltetek; ilyenkor csak azok közül keres, és sokkal pontosabb.

**Hogyan működik:** a stuhmer.hu 43 szaloncukor-fotóján előre kimértük a sztaniol színeit (CIELAB).
A telefonon a fehér papír alapján fehéregyensúlyt és fényerőt korrigálunk, majd színtávolság (CIEDE2000)
alapján rangsorolunk. Minden a telefonon fut; a fotó nem kerül fel sehova.

Nem hivatalos oldal, a Stühmerhez nincs köze. A termékfotók a stuhmer.hu oldalról töltődnek be.
