from flask import Flask, render_template
from usominidom import getContenutoFinale

app = Flask(__name__)

@app.route('/')
def index():
    # Recupera la settimana o i dati necessari dal tuo calendario o da altre fonti
    week_data = getContenutoFinale()

    return render_template('index_refractor.html', week_data=week_data)

if __name__ == '__main__':
    app.run(debug=True)