function guardarPropiedadScript() {
  // 1. Reemplaza este texto por el enlace real de tu Plan de trabajo
  // Asegúrate de dejar las comillas simples al principio y al final.
  const enlacePlanTrabajo = 'https://docs.google.com/spreadsheets/d/1WyR4KzcCnx2Zhs4rOgG9lwMYVVgIL4wrU5fi8qqXi3g/edit?gid=0#gid=0'; 
  
  // 2. Llama al servicio de propiedades del script y guarda el valor
  PropertiesService.getScriptProperties().setProperty('APPSHEET_ID_PLAN', enlacePlanTrabajo);
  
  // 3. Mensaje de confirmación
  Logger.log('La propiedad APPSHEET_ID_PLAN se ha guardado correctamente.');
}

function verificarPropiedad() {
  const valorGuardado = PropertiesService.getScriptProperties().getProperty('APPSHEET_ID_PLAN');
  Logger.log('El valor guardado es: ' + valorGuardado);
}