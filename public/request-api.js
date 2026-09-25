export async function requestAPI(path='',body,token){
  const response=await fetch(`/api/requests${path}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Request service unavailable.');return data;
}
export const youtubeLink=id=>`https://www.youtube.com/watch?v=${id}`;
