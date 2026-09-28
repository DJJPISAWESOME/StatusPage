export async function requestAPI(path='',body){
  const response=await fetch(`/api/requests${path}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok){const error=new Error(data.error||'Request service unavailable.');error.code=data.code;error.status=response.status;throw error;}return data;
}
export const youtubeLink=id=>`https://www.youtube.com/watch?v=${id}`;
