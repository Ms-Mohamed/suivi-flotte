"""Génère shared/plan_comptable.json directement depuis le fichier Word (source de vérité)."""
import docx, json, re, sys
src = sys.argv[1]; out = sys.argv[2]
d = docx.Document(src)
def clean(s):
    s = re.sub(r'\\frac\{\\text\{([^}]*)\}\}\{12\}', r'\1 / 12', s)
    s = re.sub(r'\\text\{([^}]*)\}', r'\1', s).replace('\\times', '×').replace('$', '')
    return re.sub(r'\s+', ' ', s).strip()
t0, t1, t2 = d.tables
produits = [dict(code=r.cells[0].text.strip(), label=r.cells[1].text.strip(), mode=clean(r.cells[2].text))
            for r in t0.rows[1:-1]]
groupes, cur = [], None
for r in t1.rows[1:-1]:
    c = [x.text.strip() for x in r.cells]
    if not c[0].isdigit():
        cur = dict(key=None, titre=c[0], note=c[2], comptes=[]); groupes.append(cur)
    else:
        cur['comptes'].append(dict(code=c[0], label=c[1], mode=clean(c[2])))
keys = {'CHARGES VARIABLES':'variables','CHARGES FIXES':'fixes','AMORTISSEMENTS':'amortissements'}
for g in groupes: g['key'] = keys[g['titre']]
calc = [dict(etape=r.cells[0].text.strip(), formule=clean(r.cells[1].text), montant=r.cells[2].text.strip()) for r in t2.rows[1:]]
json.dump(dict(produits=produits, charges=groupes, resultat=calc,
  totaux=dict(A=t0.rows[-1].cells[1].text.strip(), B=t1.rows[-1].cells[1].text.strip())), open(out,'w'), ensure_ascii=False, indent=2)
print(len(produits),'produits;',sum(len(g['comptes']) for g in groupes),'charges')
