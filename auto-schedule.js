function checarHorario() {
    const agora = new Date();
    const horas = agora.getHours();
    const minutos = agora.getMinutes();
    
    console.log(`[${horas.toString().padStart(2, '0')}:${minutos.toString().padStart(2, '0')}] Vigiando o relógio...`);

    if (horas >= 16) {
        console.log("\n⏰ 16:00 ALCANÇADO! ACORDANDO O AUTOMATOR DE EMAIL...");
        
        fetch('http://localhost:3000/api/email/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}) // Envia vazio para disparar a Copy Automática da IA de todos os leads!
        })
        .then(res => res.json())
        .then(data => {
            console.log("✅ RESPOSTA DO MOTOR:", data);
            process.exit(0); // Função completada, morre em paz.
        })
        .catch(err => {
            console.error("❌ ERRO FATAL AO DISPARAR:", err.message);
            process.exit(1);
        });
    } else {
        setTimeout(checarHorario, 60000); // Tentar novamente daqui a 1 minuto
    }
}

console.log("==================================================");
console.log(" MORDOMO DE AGENDAMENTO INICIADO - TARGET: 16:00 ");
console.log("==================================================");
checarHorario();
