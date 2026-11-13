# Szaloncukor-felismerő

Családi segédlet: melyik Stühmer szaloncukor van a kezünkben – a sztaniol színe alapján, AI nélkül.

**Használat:** nyisd meg a linket Safariban vagy Chrome-ban (főképernyőre is tehető). Utána:

1. **Kamera indítása** (csak a hátsó kamera). Tartsd a szaloncukrot úgy, hogy a sztaniol beleférjen a
   körvonalba, a fehér papírvégek pedig a kék sávokba essenek. Ha a szaloncukor nem fér bele, a − / + gombbal
   egyszer állítsd be a sablon méretét (megjegyzi).
2. Amíg gyűjti a színeket, a körvonal **sárgán pulzál**; ha elég kép egyezik, **zölden villog**, és jön az eredmény.
   Közben képkockánként a papírvégekből korrigálja a fényviszonyokat, és a sztaniol színeit sok képen átlagolja.
3. A 3 legvalószínűbb ízt mutatja nagy gyári fotóval, alatta ízvilág, fő ízek, töltelék, bevonat – a végső döntés a tiéd.
4. Ha eltalálta: **Ez az – megjegyzem**. 3 megerősítés után (legalább 2 ízből) az app megtanulja a
   telefon és a lámpák színtorzítását, és onnantól korrigálja (⚙ Beállítások → Tanulás).

Ha a kamera nem indul (pl. egyes iOS-verziókon a főképernyős módban), a **kézi mód** működik: fotó vagy galéria,
koppintás a papírvégre, keret a sztaniolra.

A ⚙ Beállításokban bepipálható, mit rendeltetek; ilyenkor csak azok közül keres, és sokkal pontosabb.

**Hogyan működik:** a stuhmer.hu 43 szaloncukor-fotóján előre kimértük a sztaniol színeit (CIELAB,
k-közép csoportosítás). A kamerás módban a sablon (szaloncukor-körvonal) adja meg, hol a papír és hol a sztaniol;
a papír alapján képkockánként fehéregyensúlyt és fényerőt korrigálunk, a sztaniol színeit sok képkockán gyűjtjük,
ugyanúgy csoportosítjuk, és színtávolság (CIEDE2000) alapján rangsorolunk. A kalibráció a megerősített mérésekből
illeszt egy világosság-, telítettség- és árnyalat-korrekciót. Minden a telefonon fut; a kép nem kerül fel sehova.

Nem hivatalos oldal, a Stühmerhez nincs köze. A termékfotók a stuhmer.hu oldalról töltődnek be.
