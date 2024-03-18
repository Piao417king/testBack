/**
 * 题目用1-9的数字，填入XXXX * X =XXXX使算式成立，不能重复 ，用ts实现
*/
for (let xxxx = 1234; xxxx <= 9876; xxxx++) {
    for (let x = 2; x <= 8; x++) {
        const product = xxxx * x
        if (product >= 1234 && product <= 9876) {
            const productstr = product.toString().split('');
            const d = xxxx.toString().split('');
            const allDigits = new Set([...d , ...productstr,...[x.toString()] ])
            if(allDigits.size == 9 ){
                let isCan = true 
                allDigits.forEach(e=>{
                    if(e == "0"){
                        isCan = false
                    }
                })
                if(isCan){
                    console.log(`${xxxx} *  ${x} = ${product}`)
                }
            }

        }
        else{
            break
        }
    }
}