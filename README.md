# Szaloncukor-felismerő

Családi segédlet: melyik Stühmer szaloncukor van a kezünkben – a sztaniol színe alapján, AI nélkül.

**Használat:** nyisd meg a linket Safariban → Megosztás → *Főképernyőhöz adás*. Utána:

1. Fotózd le a szaloncukrot közelről (szórt fény, vaku nélkül).
2. Koppints a **fehér papírvégre** – ebből igazítja a színeket a fényviszonyokhoz.
3. Húzz **keretet a sztaniolra** (a sávval/címkével együtt). A keret összes képpontjából kiszámolja a
   sztaniol színeit és arányukat; a papírt, a csillogást és az árnyékot kihagyja.
   (Koppintás is működik: fő szín, majd sáv/címke vagy *Nincs más színe*.)
4. A 3 legvalószínűbb ízt mutatja a webshop-fotójával – a végső döntés a tiéd.
5. Ha eltalálta: **Ez az – megjegyzem**. 3 megerősítés után (legalább 2 ízből) az app megtanulja a
   telefon és a lámpák színtorzítását, és onnantól korrigálja (⚙ Beállítások → Tanulás).

A ⚙ Beállításokban bepipálható, mit rendeltetek; ilyenkor csak azok közül keres, és sokkal pontosabb.

**Hogyan működik:** a stuhmer.hu 43 szaloncukor-fotóján előre kimértük a sztaniol színeit (CIELAB,
k-közép csoportosítás). A telefonon a fehér papír alapján fehéregyensúlyt és fényerőt korrigálunk, a keretből
ugyanígy kinyerjük a színeket, majd színtávolság (CIEDE2000) alapján rangsorolunk. A kalibráció a
megerősített mérésekből illeszt egy világosság-, telítettség- és árnyalat-korrekciót. Minden a telefonon fut;
a fotó nem kerül fel sehova.

Nem hivatalos oldal, a Stühmerhez nincs köze. A termékfotók a stuhmer.hu oldalról töltődnek be.
