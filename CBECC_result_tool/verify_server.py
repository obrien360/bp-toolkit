import urllib.request
import json

html_req = urllib.request.urlopen('http://127.0.0.1:8080/')
html_content = html_req.read().decode('utf-8')
print('HTML status:', html_req.status, 'length:', len(html_content))
assert 'CBECC Result Tool' in html_content

api_req = urllib.request.urlopen('http://127.0.0.1:8080/api/scan')
api_json = json.loads(api_req.read().decode('utf-8'))
print('API scan status:', api_req.status, 'success:', api_json.get('success'), 'fileCount:', api_json.get('fileCount'))
assert api_json['fileCount'] == 5

for f in api_json['files']:
    s = f['summary']
    name = f['scenarioName']
    gt = s['grandTotal_kBtu']
    el = s['totalElectricity_kWh']
    gas = s['totalNaturalGas_therm']
    print(f" - Scenario: {name:4} | Grand Total: {gt:>10,.2f} kBtu | Elec: {el:>10,.2f} kWh | Gas: {gas:>8,.2f} therm")

print('\nALL SERVER TESTS PASSED SUCCESSFULLY!')
