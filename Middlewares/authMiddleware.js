const jwt = require('jsonwebtoken');

const authMiddleware = async (
    req,
    res,
    next
) => {

    try {

        const authHeader =
            req.headers.authorization;


        if (
            !authHeader ||
            !authHeader.startsWith('Bearer ')
        ) {

            return res.status(401).json({
                message: 'Non autorisé'
            });
        }


        const token =
            authHeader.split(' ')[1];


        const decoded =
            jwt.verify(
                token,
                process.env.JWT_SECRET
            );


        req.userId =
            decoded.userId;


        req.userRole =
            decoded.role;


        next();

    } catch (error) {

        return res.status(401).json({
            message: 'Session invalide ou expirée'
        });
    }
};


module.exports = authMiddleware;